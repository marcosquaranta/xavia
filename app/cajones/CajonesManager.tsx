'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { CajonMovimiento, ClienteVenta } from '@/lib/types';
import type { SaldoCajonCliente, AlertaCajon, TeoricoCajonCliente } from '@/lib/cajones';
import NumberInput from '@/components/NumberInput';

const HOY = new Date().toISOString().split('T')[0];
const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

export default function CajonesManager({ saldos, teorico, alertas, clientes, movimientos, unidadesPorCajonRucula, unidadesPorCajonLechuga, esAdmin }: {
  saldos: SaldoCajonCliente[]; teorico: Record<string, TeoricoCajonCliente>; alertas: AlertaCajon[];
  clientes: ClienteVenta[]; movimientos: CajonMovimiento[]; unidadesPorCajonRucula: number; unidadesPorCajonLechuga: number; esAdmin: boolean;
}) {
  const router = useRouter();
  const [idControl, setIdControl] = useState('');
  const [tipo, setTipo] = useState<'entrega' | 'devolucion'>('entrega');
  const [cantidad, setCantidad] = useState(0);
  const [fecha, setFecha] = useState(HOY);
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msgOk, setMsgOk] = useState<string | null>(null);

  const [editandoConfig, setEditandoConfig] = useState(false);
  const [nuevoRucula, setNuevoRucula] = useState(String(unidadesPorCajonRucula));
  const [nuevoLechuga, setNuevoLechuga] = useState(String(unidadesPorCajonLechuga));
  const [guardandoConfig, setGuardandoConfig] = useState(false);

  const [verHistorial, setVerHistorial] = useState(false);

  const totalEnLaCalle = saldos.reduce((a, s) => a + Math.max(0, s.saldo), 0);
  const clientesConSaldo = saldos.filter(s => s.saldo > 0).length;

  // String(...) obligatorio: si id_control viene como número nativo desde Sheets (celda
  // cargada como número, no como texto), esta comparación nunca hacía match contra el id
  // (siempre string, viene de un <select>) — cualquier registro nuevo guardaba
  // nombre_cliente vacío/con el id pelado, en vez del nombre real del cliente.
  const nombreCliente = (id: string) => clientes.find(c => String(c.id_control) === id)?.nombre_display || clientes.find(c => String(c.id_control) === id)?.nombre_xubio || id;

  // Info del cliente elegido en el formulario — aparece apenas se selecciona, para que
  // quien carga la entrega/devolución pueda chequear contra el teórico al toque, sin
  // tener que ir a buscarlo en el cuadro de abajo.
  const infoCliente = useMemo(() => {
    if (!idControl) return null;
    const s = saldos.find(x => x.id_control === idControl) || null;
    const t = teorico[idControl] || null;
    return { saldo: s, teorico: t };
  }, [idControl, saldos, teorico]);

  async function registrar() {
    if (!idControl) { setError('Elegí un cliente.'); return; }
    if (!(cantidad > 0)) { setError('Ingresá una cantidad válida.'); return; }
    setGuardando(true); setError(null); setMsgOk(null);
    try {
      const res = await fetch('/api/cajones/movimiento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, id_control: idControl, nombre_cliente: nombreCliente(idControl), tipo, cantidad, notas }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Error al guardar');
      setMsgOk(`${tipo === 'entrega' ? 'Entrega' : 'Devolución'} registrada: ${cantidad} cajones — ${nombreCliente(idControl)}`);
      setCantidad(0); setNotas('');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarConfig() {
    const valorRucula = Number(nuevoRucula), valorLechuga = Number(nuevoLechuga);
    if (!(valorRucula > 0) || !(valorLechuga > 0)) return;
    setGuardandoConfig(true);
    try {
      const res = await fetch('/api/cajones/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unidades_por_cajon_rucula: valorRucula, unidades_por_cajon_lechuga: valorLechuga }),
      });
      if (!res.ok) throw new Error('Error al guardar');
      setEditandoConfig(false);
      router.refresh();
    } catch {} finally {
      setGuardandoConfig(false);
    }
  }

  async function borrarMovimiento(id_movimiento: string) {
    if (!confirm('¿Borrar este movimiento?')) return;
    try {
      await fetch('/api/cajones/movimiento', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_movimiento }) });
      router.refresh();
    } catch {}
  }

  // Las dos tarjetas de arriba llevan al detalle por cliente de más abajo (mismo dato,
  // desglosado) — antes eran solo decorativas, sin ningún lugar adonde ir al tocarlas.
  function irADetalle() {
    document.getElementById('detalle-saldo-cliente')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div>
      {/* Totales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginBottom: '16px' }}>
        <div onClick={irADetalle} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && irADetalle()}
          style={{ background: '#111827', borderRadius: '10px', padding: '16px', cursor: 'pointer' }} title="Ver detalle por cliente">
          <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 700 }}>Cajones en la calle</p>
          <p style={{ margin: 0, fontSize: '32px', fontWeight: 800, color: 'white' }}>{fmt(totalEnLaCalle)}</p>
        </div>
        <div onClick={irADetalle} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && irADetalle()}
          style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', cursor: 'pointer' }} title="Ver detalle por cliente">
          <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Clientes con saldo</p>
          <p style={{ margin: 0, fontSize: '32px', fontWeight: 800, color: '#111827' }}>{clientesConSaldo}</p>
        </div>
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Unidades por cajón</p>
          {esAdmin && editandoConfig ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#6b7280', width: '52px' }}>Rúcula</span>
                <input type="number" value={nuevoRucula} onChange={e => setNuevoRucula(e.target.value)} style={{ width: '70px', fontSize: '15px', padding: '4px 6px' }} disabled={guardandoConfig} />
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#6b7280', width: '52px' }}>Lechuga</span>
                <input type="number" value={nuevoLechuga} onChange={e => setNuevoLechuga(e.target.value)} style={{ width: '70px', fontSize: '15px', padding: '4px 6px' }} disabled={guardandoConfig} />
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={guardarConfig} className="btn" style={{ fontSize: '11px', padding: '5px 8px' }} disabled={guardandoConfig}>✓ Guardar</button>
                <button onClick={() => { setEditandoConfig(false); setNuevoRucula(String(unidadesPorCajonRucula)); setNuevoLechuga(String(unidadesPorCajonLechuga)); }} className="btn secondary" style={{ fontSize: '11px', padding: '5px 8px' }}>×</button>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#111827' }}>
                {unidadesPorCajonRucula} <span style={{ fontSize: '11px', fontWeight: 400, color: '#9ca3af' }}>rúc.</span> · {unidadesPorCajonLechuga} <span style={{ fontSize: '11px', fontWeight: 400, color: '#9ca3af' }}>lech.</span>
              </p>
              {esAdmin && <button onClick={() => setEditandoConfig(true)} style={{ fontSize: '11px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 400, padding: 0 }}>editar</button>}
            </div>
          )}
          <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#9ca3af' }}>usadas para el cálculo teórico</p>
        </div>
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <div style={{ background: '#fef2f2', border: '2px solid #dc2626', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 800, color: '#991b1b' }}>⚠️ Clientes que deben cajones sin movimiento hace más de 7 días</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {alertas.map(a => (
              <p key={a.id_control} style={{ margin: 0, fontSize: '12.5px', color: '#7f1d1d' }}>
                <strong>{a.nombre}</strong> debe <strong>{fmt(a.saldo)}</strong> cajones — sin movimiento hace {a.diasSinMovimiento} días
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Formulario rápido */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <p className="card-title">Registrar movimiento</p>
        {error && <div className="alert-box error" style={{ marginBottom: '10px' }}>{error}</div>}
        {msgOk && <div className="alert-box" style={{ marginBottom: '10px', background: '#f0fdf4', border: '1px solid #86efac', color: '#166534' }}>{msgOk}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '12px', marginBottom: '12px' }}>
          <div>
            <label style={{ fontSize: '11px', color: '#6b7280' }}>Cliente</label>
            <select value={idControl} onChange={e => setIdControl(e.target.value)} disabled={guardando}>
              <option value="">Elegir cliente...</option>
              {clientes.map(c => <option key={c.id_control} value={c.id_control}>{c.nombre_display || c.nombre_xubio}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', color: '#6b7280' }}>Cantidad</label>
            <NumberInput value={cantidad} onChange={setCantidad} min={0} disabled={guardando} />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: '#6b7280' }}>Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} disabled={guardando} />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: '#6b7280' }}>Notas (opcional)</label>
            <input type="text" value={notas} onChange={e => setNotas(e.target.value)} disabled={guardando} />
          </div>
        </div>

        {/* Info instantánea del cliente elegido — para chequear contra el teórico antes de confirmar */}
        {infoCliente && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '12.5px' }}>
            <span>
              <strong style={{ color: '#1e40af' }}>{infoCliente.saldo ? fmt(infoCliente.saldo.saldo) : 0}</strong>
              <span style={{ color: '#6b7280' }}> en la calle ahora</span>
            </span>
            <span>
              <strong style={{ color: '#1e40af' }}>{infoCliente.teorico ? fmt(infoCliente.teorico.teorico) : '—'}</strong>
              <span style={{ color: '#6b7280' }}> teóricos</span>
              {infoCliente.teorico && (
                <span style={{ color: '#9ca3af' }}> ({fmt(infoCliente.teorico.teoricoRucula)} rúc. + {fmt(infoCliente.teorico.teoricoLechuga)} lech.)</span>
              )}
            </span>
            <span style={{ color: '#6b7280' }}>
              Último movimiento: {infoCliente.saldo?.ultimoMovimiento ? `${infoCliente.saldo.ultimoMovimiento} (hace ${infoCliente.saldo.diasSinMovimiento}d)` : 'nunca'}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => setTipo('entrega')} disabled={guardando}
              style={{ padding: '10px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, border: 'none', cursor: 'pointer', background: tipo === 'entrega' ? '#d97706' : '#f3f4f6', color: tipo === 'entrega' ? 'white' : '#374151' }}>
              📤 Entregar
            </button>
            <button onClick={() => setTipo('devolucion')} disabled={guardando}
              style={{ padding: '10px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, border: 'none', cursor: 'pointer', background: tipo === 'devolucion' ? '#059669' : '#f3f4f6', color: tipo === 'devolucion' ? 'white' : '#374151' }}>
              📥 Recibir devolución
            </button>
          </div>
          <button onClick={registrar} className="btn" disabled={guardando} style={{ marginLeft: 'auto' }}>
            {guardando ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </div>

      {/* Resumen por cliente */}
      <div id="detalle-saldo-cliente" className="card" style={{ marginBottom: '16px', scrollMarginTop: '16px' }}>
        <p className="card-title">Saldo por cliente</p>
        {saldos.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Todavía no hay movimientos de cajones registrados.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '12.5px', width: '100%' }}>
              <thead><tr>
                <th style={{ textAlign: 'left' }}>Cliente</th>
                <th style={{ textAlign: 'right' }}>Entregados</th>
                <th style={{ textAlign: 'right' }}>Devueltos</th>
                <th style={{ textAlign: 'right' }}>En la calle</th>
                <th style={{ textAlign: 'right' }} title="Estimado según lo vendido ÷ unidades por cajón, por cultivo">Teórico</th>
                <th style={{ textAlign: 'right' }} title="Entregados reales − teórico">Diferencia</th>
                <th style={{ textAlign: 'right' }}>Último mov.</th>
              </tr></thead>
              <tbody>
                {saldos.map(s => {
                  const t = teorico[s.id_control];
                  const diff = t ? s.entregados - t.teorico : null;
                  const alerta = s.saldo > 0 && s.diasSinMovimiento !== null && s.diasSinMovimiento > 7;
                  return (
                    <tr key={s.id_control} style={{ borderBottom: '1px solid #f3f4f6', background: alerta ? '#fef2f2' : 'transparent' }}>
                      <td style={{ fontWeight: 500 }}>{s.nombre}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(s.entregados)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(s.devueltos)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: s.saldo > 0 ? '#d97706' : '#9ca3af' }}>{fmt(s.saldo)}</td>
                      <td style={{ textAlign: 'right', color: '#6b7280' }} title={t ? `${fmt(t.teoricoRucula)} rúcula + ${fmt(t.teoricoLechuga)} lechuga` : ''}>{t ? fmt(t.teorico) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: diff === null ? '#9ca3af' : diff > 0 ? '#059669' : diff < 0 ? '#dc2626' : '#9ca3af' }}>
                        {diff !== null ? `${diff > 0 ? '+' : ''}${fmt(diff)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: alerta ? '#dc2626' : '#9ca3af', fontWeight: alerta ? 700 : 400 }}>
                        {s.ultimoMovimiento ? `${s.diasSinMovimiento}d` : 'nunca'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ margin: '10px 0 0', fontSize: '10px', color: '#9ca3af' }}>Teórico = unidades vendidas históricas al cliente ÷ unidades por cajón de cada cultivo — una estimación para comparar, no un conteo exacto.</p>
      </div>

      {/* Historial */}
      <div className="card">
        <button onClick={() => setVerHistorial(v => !v)} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '12px', cursor: 'pointer', padding: 0, fontWeight: 600 }}>
          {verHistorial ? '▾ Ocultar historial' : '▸ Ver historial de movimientos'} ({movimientos.length})
        </button>
        {verHistorial && (
          <div style={{ marginTop: '12px', overflowX: 'auto' }}>
            <table style={{ fontSize: '12px', width: '100%' }}>
              <thead><tr>
                <th style={{ textAlign: 'left' }}>Fecha</th>
                <th style={{ textAlign: 'left' }}>Cliente</th>
                <th style={{ textAlign: 'left' }}>Tipo</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th>
                <th style={{ textAlign: 'left' }}>Notas</th>
                {esAdmin && <th></th>}
              </tr></thead>
              <tbody>
                {[...movimientos].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))).map(m => (
                  <tr key={m.id_movimiento} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td>{m.fecha}</td>
                    <td>{m.nombre_cliente}</td>
                    <td style={{ color: m.tipo === 'entrega' ? '#d97706' : '#059669', fontWeight: 600 }}>{m.tipo === 'entrega' ? '📤 Entrega' : '📥 Devolución'}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(Number(m.cantidad) || 0)}</td>
                    <td style={{ color: '#9ca3af', fontSize: '11px' }}>{m.notas}</td>
                    {esAdmin && (
                      <td><button onClick={() => borrarMovimiento(m.id_movimiento)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '11px' }}>Borrar</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
