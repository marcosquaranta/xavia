'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MEDIOS_PAGO } from '@/lib/types';
import type { SaldoMes } from '@/lib/cuentas';

// ── Saldos de cada cuenta y movimientos entre cuentas ──────────────────────────
//
// Esto es el extracto del mes de cada cuenta: con qué arrancó, qué entró, qué salió y con
// qué termina, contra el saldo real del resumen. La diferencia es plata que se movió sin
// quedar registrada: mientras no sea cero, falta cargar algo.
//
// Las cobranzas NO se cargan acá. Entran por la bandeja de Cobranzas, que es donde están
// las facturas y el cliente; cargarlas también acá era un segundo lugar para lo mismo y la
// garantía de contar dos veces el mismo cobro.
//
// Los movimientos ENTRE cuentas sí: pagar el resumen de la tarjeta o pasar plata de un banco
// a otro no es un gasto —la plata sigue siendo de la empresa— pero mueve los dos saldos, y
// sin cargarlos la conciliación no cierra nunca. Antes existían (como gasto de categoría
// "movimiento interno") pero no se veían por ningún lado: la columna "entre cuentas" daba
// un número y no había forma de saber de dónde salía.

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const cel: React.CSSProperties = { padding: '5px 8px', fontSize: '12.5px' };
const celNum: React.CSSProperties = { ...cel, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export interface MovimientoCuenta {
  id_gasto: string;
  fecha: string;
  descripcion: string;
  monto: number;
  origen: string;
  destino: string;
}

export default function CuentasEditor({ anio, mes, saldos, movimientos }: {
  anio: number; mes: number; saldos: SaldoMes[];
  movimientos: MovimientoCuenta[];
}) {
  const router = useRouter();
  const [fecha, setFecha] = useState(`${anio}-${String(mes).padStart(2, '0')}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`);
  const [origen, setOrigen] = useState<string>(MEDIOS_PAGO[0]);
  const [destino, setDestino] = useState<string>(MEDIOS_PAGO[1]);
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El saldo inicial normalmente no se toca: es el cierre del mes anterior. Pero el primer
  // mes ese cierre no existe, y sin poder sembrarlo la conciliación nunca puede dar. Se
  // guarda como el saldo REAL del mes anterior, que es exactamente lo que es.
  const [inicialSemilla, setInicialSemilla] = useState<Record<string, string>>({});
  const [saldoReal, setSaldoReal] = useState<Record<string, string>>(
    Object.fromEntries(saldos.map((s) => [s.medio, s.real === null ? '' : String(Math.round(s.real))])),
  );

  async function llamar(body: any) {
    setOcupado(true); setError(null);
    try {
      const res = await fetch('/api/cuentas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      router.refresh();
      return true;
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar');
      return false;
    } finally { setOcupado(false); }
  }

  // El movimiento se guarda como un gasto de categoría "movimiento interno": es el mismo
  // registro que ya usaba la app, así que lo que se carga acá y lo que se cargó desde Gastos
  // son la misma cosa y no hay dos verdades.
  async function agregarMovimiento() {
    const m = Number(monto);
    if (!isFinite(m) || m <= 0) { setError('Ingresá un monto mayor a 0'); return; }
    if (origen === destino) { setError('La cuenta de origen y la de destino tienen que ser distintas.'); return; }
    setOcupado(true); setError(null);
    try {
      const res = await fetch('/api/gastos/nuevo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha, descripcion: notas || `${origen} → ${destino}`,
          categoria: 'movimiento_interno', monto: m,
          medio_pago: origen, medio_pago_destino: destino,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMonto(''); setNotas('');
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar el movimiento');
    } finally { setOcupado(false); }
  }

  async function borrarMovimiento(id: string) {
    if (!confirm('Se borra este movimiento entre cuentas. Los dos saldos vuelven a como estaban. ¿Confirmás?')) return;
    setOcupado(true); setError(null);
    try {
      const res = await fetch('/api/gastos/borrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: id }),
      });
      if (!res.ok) throw new Error('No se pudo borrar');
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'No se pudo borrar');
    } finally { setOcupado(false); }
  }

  const totalMovido = movimientos.reduce((a, m) => a + (Number(m.monto) || 0), 0);
  const mesPrev = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  // Se muestran TODAS las cuentas aunque no hayan tenido movimiento: si solo aparecieran
  // las que se movieron, no habría dónde cargar el saldo real de las demás — y el primer
  // mes, que es justo cuando hay que sembrar los saldos iniciales, no aparecería casi
  // ninguna.
  const filas = saldos;

  return (
    <div>
      {error && <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#dc2626' }}>{error}</p>}

      {/* ── Movimientos entre cuentas ── */}
      <p style={{ margin: '0 0 6px', fontSize: '11.5px', color: '#6b7280' }}>
        Plata que pasa de una cuenta a otra: pagar el resumen de la tarjeta, una transferencia entre bancos, retirar
        efectivo. <strong>No es un gasto</strong> —la plata sigue siendo de la empresa— pero mueve los dos saldos.
        Las cobranzas no van acá: entran por la pantalla de Cobranzas.
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '10px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={ocupado}
            style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Sale de</label>
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} disabled={ocupado}
            style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }}>
            {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Entra a</label>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} disabled={ocupado}
            style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px', borderColor: origen === destino ? '#dc2626' : '#e5e7eb' }}>
            {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Monto</label>
          <input type="number" value={monto} onChange={(e) => setMonto(e.target.value)} min={0} step={1} disabled={ocupado} placeholder="0"
            style={{ width: '130px', textAlign: 'right', fontSize: '13px', fontWeight: 600, padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
        </div>
        <div style={{ flex: '1 1 140px', minWidth: '120px' }}>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Detalle</label>
          <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} disabled={ocupado} placeholder="Ej: pago resumen VISA"
            style={{ width: '100%', fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
        </div>
        <button onClick={agregarMovimiento} className="btn" disabled={ocupado} style={{ fontSize: '12px' }}>Agregar</button>
      </div>

      {movimientos.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id_gasto} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={{ ...cel, color: '#6b7280', width: '90px' }}>{String(m.fecha).split('-').reverse().join('/')}</td>
                <td style={cel}>
                  <strong>{m.origen}</strong> <span style={{ color: '#9ca3af' }}>→</span> <strong>{m.destino || '—'}</strong>
                </td>
                <td style={{ ...cel, color: '#9ca3af' }}>{m.descripcion}</td>
                <td style={{ ...celNum, fontWeight: 700 }}>{$(Number(m.monto) || 0)}</td>
                <td style={{ ...cel, width: '30px', textAlign: 'right' }}>
                  <button onClick={() => borrarMovimiento(m.id_gasto)} disabled={ocupado}
                    title="Borrar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '13px', padding: 0 }}>×</button>
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid #e5e7eb' }}>
              <td colSpan={3} style={{ ...cel, fontWeight: 700 }}>Total movido entre cuentas</td>
              <td style={{ ...celNum, fontWeight: 800 }}>{$(totalMovido)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}

      {/* ── Conciliación ── */}
      <p style={{ margin: '14px 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Saldos por cuenta
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
          <thead>
            <tr style={{ background: '#fafaf9' }}>
              {['Cuenta', 'Inicial', '+ Cobrado', '− Gastos', '± Entre cuentas', '= Calculado', 'Real del resumen', 'Dif.'].map((h, i) => (
                <th key={h} style={{ ...cel, textAlign: i === 0 ? 'left' : 'right', fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((s) => {
              const dif = s.diferencia;
              return (
                <tr key={s.medio} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ ...cel, fontWeight: 600 }}>
                    {s.medio}
                    {!s.hayInicial && <span title="No hay saldo de cierre del mes anterior: el inicial arranca en cero" style={{ color: '#b45309', marginLeft: '4px' }}>·</span>}
                  </td>
                  <td style={{ ...cel, textAlign: 'right' }}>
                    <input type="number" value={inicialSemilla[s.medio] ?? (s.hayInicial ? String(Math.round(s.inicial)) : '')} step={1} disabled={ocupado}
                      onChange={(e) => setInicialSemilla((p) => ({ ...p, [s.medio]: e.target.value }))}
                      onBlur={() => {
                        const v = inicialSemilla[s.medio];
                        if (v === '' || v === undefined) return;
                        if (s.hayInicial && Number(v) === Math.round(s.inicial)) return;
                        llamar({ accion: 'saldo_guardar', anio: mesPrev.anio, mes: mesPrev.mes, medio_pago: s.medio, saldo_real: Number(v) });
                      }}
                      title={s.hayInicial
                        ? 'Es el cierre del mes anterior. Se puede corregir: lo que escribas acá se guarda como el saldo real de ese mes.'
                        : 'No hay cierre del mes anterior: cargá acá el saldo con el que arranca esta cuenta. Se guarda como el cierre del mes pasado.'}
                      placeholder={s.hayInicial ? '0' : 'sembrar'}
                      style={{
                        width: '110px', textAlign: 'right', fontSize: '12.5px', padding: '3px 6px', borderRadius: '4px',
                        border: s.hayInicial ? '1px solid #e5e7eb' : '1px dashed #b45309',
                        color: s.hayInicial ? '#6b7280' : '#111827',
                      }} />
                  </td>
                  <td style={{ ...celNum, color: s.cobranzas ? '#059669' : '#d1d5db' }}>{$(s.cobranzas)}</td>
                  <td style={{ ...celNum, color: s.gastos ? '#b45309' : '#d1d5db' }}>{$(s.gastos)}</td>
                  <td style={{ ...celNum, color: '#6b7280' }}>{$(s.entradas - s.salidas)}</td>
                  <td style={{ ...celNum, fontWeight: 700 }}>{$(s.calculado)}</td>
                  <td style={{ ...cel, textAlign: 'right' }}>
                    <input type="number" value={saldoReal[s.medio] ?? ''} step={1} disabled={ocupado}
                      onChange={(e) => setSaldoReal((p) => ({ ...p, [s.medio]: e.target.value }))}
                      onBlur={() => {
                        const v = saldoReal[s.medio];
                        if (v === '' || v === undefined) return;
                        if (s.real !== null && Number(v) === s.real) return;
                        llamar({ accion: 'saldo_guardar', anio, mes, medio_pago: s.medio, saldo_real: Number(v) });
                      }}
                      placeholder="—"
                      style={{ width: '110px', textAlign: 'right', fontSize: '12.5px', padding: '3px 6px', border: '1px solid #e5e7eb', borderRadius: '4px' }} />
                  </td>
                  <td style={{ ...celNum, fontWeight: 800, color: dif === null ? '#d1d5db' : Math.abs(dif) < 1 ? '#059669' : '#dc2626' }}>
                    {dif === null ? '—' : Math.abs(dif) < 1 ? '✓' : $(dif)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af', lineHeight: 1.5 }}>
        El saldo inicial de cada cuenta es el <strong>saldo real que cargaste el mes anterior</strong>, igual que el stock de insumos.
        La primera vez no existe: escribilo en la columna «Inicial» y queda guardado como el cierre del mes pasado.
        La diferencia contra el resumen es plata que se movió sin quedar registrada: mientras no dé ✓, falta cargar algo.
        Un movimiento entre cuentas no se cuenta como gasto — sale de una y entra en la otra.
        El <strong>cliente es opcional</strong>: para los saldos no hace falta, pero cada cobranza que lo lleve acerca a poder calcular deudores por venta acá en vez de en Xubio.
      </p>
    </div>
  );
}
