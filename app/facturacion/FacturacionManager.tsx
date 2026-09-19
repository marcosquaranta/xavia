'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Linea { id_venta: string; campo: string; producto: string; sucursal: string; cantidad: number; precio: number; importe: number; }
interface FacturaPendiente { id_control: string; cliente: string; letra: string; fecha: string; lineas: Linea[]; unidades: number; total: number; }

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtU = (n: number) => Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : (f || 's/fecha'); };
// Cada pendiente es un cliente + un día. Esa es la unidad que se factura.
const clave = (f: FacturaPendiente) => `${f.id_control}||${f.fecha}`;

export default function FacturacionManager({ facturas }: { facturas: FacturaPendiente[] }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ emitidas: any[]; errores: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [excluidas, setExcluidas] = useState<Set<string>>(new Set());
  const [quitando, setQuitando] = useState<string | null>(null);

  const [emitiendoUna, setEmitiendoUna] = useState<string | null>(null);
  const [informe, setInforme] = useState<string | null>(null);
  // Renglon que se esta corrigiendo (id_venta + producto) y el valor tipeado.
  const [editando, setEditando] = useState<string | null>(null);
  const [valorEdit, setValorEdit] = useState('');
  const [guardando, setGuardando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const incluidas = facturas.filter(f => !excluidas.has(clave(f)));

  // Las fechas de un mismo cliente, juntas y de la más vieja a la más nueva: así se ve de
  // un vistazo el atraso acumulado de cada uno.
  const porCliente = (() => {
    const m = new Map<string, { id_control: string; cliente: string; letra: string; dias: FacturaPendiente[] }>();
    for (const f of facturas) {
      if (!m.has(f.id_control)) m.set(f.id_control, { id_control: f.id_control, cliente: f.cliente, letra: f.letra, dias: [] });
      m.get(f.id_control)!.dias.push(f);
    }
    for (const g of m.values()) g.dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
    return [...m.values()].sort((a, b) => a.cliente.localeCompare(b.cliente));
  })();
  const totalGeneral = incluidas.reduce((a, f) => a + f.total, 0);
  const totalUnidades = incluidas.reduce((a, f) => a + f.unidades, 0);
  const nA = incluidas.filter(f => f.letra === 'A').length;
  const nB = incluidas.filter(f => f.letra === 'B').length;

  function toggle(k: string) {
    setExcluidas(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  // Todos los días de un cliente de una vez.
  function toggleCliente(idControl: string, prender: boolean) {
    setExcluidas(prev => {
      const n = new Set(prev);
      for (const f of facturas.filter(x => x.id_control === idControl)) {
        if (prender) n.delete(clave(f)); else n.add(clave(f));
      }
      return n;
    });
  }

  async function quitar(id: string) {
    setQuitando(id); setErr(null);
    try {
      const r = await fetch('/api/facturacion/quitar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_control: id }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setQuitando(null); }
  }

  const claveLinea = (l: Linea) => `${l.id_venta}||${l.campo}`;

  // Corrige la cantidad de un renglon, o lo borra con 0. Toca la celda de la hoja Ventas,
  // asi que lo que se factura despues es exactamente lo corregido.
  async function guardarLinea(l: Linea, cantidad: number) {
    const k = claveLinea(l);
    setGuardando(k); setErr(null); setInforme(null);
    try {
      const r = await fetch('/api/facturacion/linea', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_venta: l.id_venta, campo: l.campo, cantidad }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setEditando(null);
      setInforme(cantidad > 0
        ? `✓ ${l.producto} quedó en ${fmtU(cantidad)}.`
        : `✓ Se borró el renglón de ${l.producto}${j.vaciaYQuitada ? ' — esa venta quedó sin productos y volvió a borrador.' : '.'}`);
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setGuardando(null); }
  }

  async function borrarLinea(l: Linea) {
    if (!window.confirm(`Se va a borrar el renglón de ${l.producto}${l.sucursal ? ` (${l.sucursal})` : ''} — ${fmtU(l.cantidad)} unidades. ¿Confirmás?`)) return;
    await guardarLinea(l, 0);
  }

  // Informe para el cliente: lo pendiente día por día CON LA FECHA DE LA ENTREGA. Se arma
  // acá con los mismos datos que muestra la pantalla, así lo que copia es lo que ve.
  function textoDetalle(g: { cliente: string; dias: FacturaPendiente[] }): string {
    const l: string[] = [`Entregas pendientes de facturar — ${g.cliente}`, ''];
    for (const d of g.dias) {
      l.push(`${fmtDia(d.fecha)}`);
      for (const li of d.lineas) {
        l.push(`  ${li.producto}${li.sucursal ? ` (${li.sucursal})` : ''} — ${fmtU(li.cantidad)} x ${fmt(li.precio)} = ${fmt(li.importe)}`);
      }
      l.push(`  Total del día: ${fmt(d.total)}`, '');
    }
    l.push(`TOTAL: ${fmt(g.dias.reduce((a, d) => a + d.total, 0))} · ${fmtU(g.dias.reduce((a, d) => a + d.unidades, 0))} unidades`);
    return l.join('\n');
  }

  async function copiarDetalle(g: { id_control: string; cliente: string; dias: FacturaPendiente[] }) {
    try {
      await navigator.clipboard.writeText(textoDetalle(g));
      setInforme(`Detalle de ${g.cliente} copiado — pegalo donde lo necesites.`);
      setTimeout(() => setInforme(null), 4000);
    } catch { setErr('No se pudo copiar al portapapeles.'); }
  }

  async function enviarDetalle(g: { id_control: string; cliente: string }) {
    if (!window.confirm(`Se le va a mandar a ${g.cliente} un mail con el detalle de todo lo pendiente de facturar, día por día. ¿Confirmás?`)) return;
    setEnviando(g.id_control); setErr(null); setInforme(null);
    try {
      const r = await fetch('/api/facturacion/detalle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: g.id_control, enviar: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setInforme(`✓ Detalle enviado a ${j.enviadoA}.`);
    } catch (e: any) { setErr(e.message); }
    finally { setEnviando(null); }
  }

  // Emite exactamente los días elegidos: una factura por cada uno.
  async function emitirPares(pares: { id_control: string; fecha: string }[]) {
    setErr(null); setResult(null);
    const r = await fetch('/api/facturacion/emitir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pares }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Error');
    return j;
  }

  // Un solo día, sin tocar nada más. Es la forma de ir sacando el atraso de a poco y ver
  // qué pasa con cada comprobante antes de mandar el siguiente.
  async function facturarUna(f: FacturaPendiente) {
    setEmitiendoUna(clave(f));
    try {
      const j = await emitirPares([{ id_control: f.id_control, fecha: f.fecha }]);
      setResult({ emitidas: j.emitidas || [], errores: j.errores || [] });
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setEmitiendoUna(null); }
  }

  async function facturar() {
    setLoading(true); setErr(null); setResult(null);
    try {
      const j = await emitirPares(incluidas.map(f => ({ id_control: f.id_control, fecha: f.fecha })));
      setResult({ emitidas: j.emitidas || [], errores: j.errores || [] });
      setConfirm(false);
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }

  if (result) {
    return (
      <div>
        <p className="card-title">Resultado de la facturación</p>
        {result.emitidas.length > 0 && (
          <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
            <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#1e40af' }}>📌 Último paso en Xubio (manual)</p>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#1e40af' }}>
              Las facturas ya están importadas. Entrá a <strong>Xubio → Comprobantes de venta</strong>, seleccionalas y apretá <strong>"Obtener CAE"</strong> (las A), y después <strong>"Enviar por correo"</strong>. La API de Xubio no permite hacer esos dos pasos automáticamente.
            </p>
          </div>
        )}
        {result.emitidas.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#166534', margin: '0 0 6px' }}>✓ Importadas a Xubio ({result.emitidas.length})</p>
            {result.emitidas.map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '5px 10px', background: '#f0fdf4', borderRadius: '6px', marginBottom: '4px' }}>
                <span>{e.cliente}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {e.emailCliente === 'enviado' && <span style={{ fontSize: '11px', color: '#059669' }} title="Detalle enviado al cliente por mail">📧 enviado</span>}
                  {e.emailCliente === 'sin_email' && <span style={{ fontSize: '11px', color: '#d97706' }} title="Este cliente no tiene email cargado">📧 sin email</span>}
                  {e.emailCliente === 'error' && <span style={{ fontSize: '11px', color: '#dc2626' }} title="Falló el envío del mail al cliente">📧 error al enviar</span>}
                  {e.fechaAjustada && (
                    <span style={{ fontSize: '11px', color: '#b45309' }}
                      title={`La venta es del ${e.fechaAjustada.venta}, pero la numeración del punto de venta ya estaba en ${e.fechaAjustada.factura}. AFIP no permite que un comprobante con número mayor tenga fecha anterior, así que la factura salió con esa fecha.`}>
                      📅 emitida con fecha {e.fechaAjustada.factura}
                    </span>
                  )}
                  <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{e.numero}{e.cae ? ` · CAE ${e.cae}` : ''}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {result.errores.length > 0 && (
          <div>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#dc2626', margin: '0 0 6px' }}>✗ Con error ({result.errores.length}) — quedan pendientes</p>
            {result.errores.map((e, i) => (
              <div key={i} style={{ fontSize: '13px', padding: '5px 10px', background: '#fef2f2', borderRadius: '6px', marginBottom: '4px' }}>
                <strong>{e.cliente}:</strong> {e.error}
              </div>
            ))}
          </div>
        )}
        <button className="btn secondary" style={{ marginTop: '12px' }} onClick={() => { setResult(null); router.refresh(); }}>Volver</button>
      </div>
    );
  }

  if (!facturas.length) {
    return <p style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', padding: '30px' }}>No hay ventas cargadas pendientes de facturar. Cargá ventas desde la sección Ventas.</p>;
  }

  return (
    <div>
      {/* Resumen + acción */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '14px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px' }}>
        <div style={{ fontSize: '13px', color: '#374151' }}>
          <strong>{incluidas.length}</strong> facturas a emitir
          {excluidas.size > 0 && <span style={{ color: '#9ca3af' }}> ({excluidas.size} sin tildar)</span>}
          <span style={{ color: '#9ca3af' }}> · {nA} A · {nB} B</span>
          <span style={{ marginLeft: '10px', fontSize: '14px', fontWeight: 700, color: '#374151' }}>{fmtU(totalUnidades)} u</span>
          <span style={{ marginLeft: '8px', fontSize: '16px', fontWeight: 800, color: '#111827' }}>{fmt(totalGeneral)}</span>
        </div>
        {!confirm
          ? <button className="btn" onClick={() => setConfirm(true)} disabled={loading || incluidas.length === 0}>📤 Facturar {incluidas.length} en Xubio</button>
          : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>¿Importar {incluidas.length} facturas a Xubio? El CAE se obtiene después en Xubio.</span>
              <button className="btn" onClick={facturar} disabled={loading}>{loading ? 'Emitiendo…' : 'Sí, facturar'}</button>
              <button className="btn secondary" onClick={() => setConfirm(false)} disabled={loading}>Cancelar</button>
            </div>
          )}
      </div>
      {err && <div className="alert-box error" style={{ marginBottom: '12px' }}>{err}</div>}
      {informe && <div className="alert-box" style={{ marginBottom: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>{informe}</div>}

      {/* Lista: un bloque por cliente, una fila por día pendiente. El día es la unidad
          que se factura — cada uno sale como su propio comprobante. */}
      {porCliente.map(g => {
        const diasIncluidos = g.dias.filter(d => !excluidas.has(clave(d)));
        const totalCliente = diasIncluidos.reduce((a, d) => a + d.total, 0);
        const uCliente = diasIncluidos.reduce((a, d) => a + d.unidades, 0);
        const todos = diasIncluidos.length === g.dias.length;
        return (
        <div key={g.id_control} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '10px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#fafafa', borderBottom: '1px solid #f3f4f6', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={todos} onChange={() => toggleCliente(g.id_control, !todos)}
                title="Incluir todos los días de este cliente" style={{ width: '17px', height: '17px', cursor: 'pointer' }} />
              <span style={{ fontSize: '11px', background: g.letra === 'A' ? '#dbeafe' : '#f3f4f6', color: g.letra === 'A' ? '#1e40af' : '#374151', padding: '1px 7px', borderRadius: '4px', fontWeight: 700 }}>Factura {g.letra}</span>
              <span style={{ fontWeight: 700, fontSize: '14px' }}>{g.cliente}</span>
              <span style={{ fontSize: '11px', color: g.dias.length > 1 ? '#b45309' : '#9ca3af', fontWeight: g.dias.length > 1 ? 700 : 400 }}>
                {g.dias.length === 1 ? '1 día' : `${g.dias.length} días pendientes`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#374151' }}>{fmtU(uCliente)} u</span>
              <span style={{ fontSize: '15px', fontWeight: 800, color: '#111827' }}>{fmt(totalCliente)}</span>
              <button onClick={() => copiarDetalle(g)} title="Copiar el detalle día por día, con la fecha de cada entrega"
                style={{ background: 'white', border: '1px solid #d1d5db', color: '#374151', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                📋 Copiar detalle
              </button>
              <button onClick={() => enviarDetalle(g)} disabled={enviando === g.id_control}
                title="Mandarle al cliente por mail el detalle de lo pendiente, día por día"
                style={{ background: 'white', border: '1px solid #bfdbfe', color: '#1d4ed8', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                {enviando === g.id_control ? 'Enviando…' : '✉️ Enviar al cliente'}
              </button>
              <button onClick={() => quitar(g.id_control)} disabled={quitando === g.id_control}
                title="Sacar de facturación TODOS los días de este cliente (vuelven a borrador)"
                style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '5px', padding: '2px 7px', fontSize: '11px', cursor: 'pointer' }}>
                {quitando === g.id_control ? '…' : '✕'}
              </button>
            </div>
          </div>

          {g.dias.map(f => {
            const k = clave(f);
            const incluida = !excluidas.has(k);
            return (
            <div key={k} style={{ borderTop: '1px solid #f3f4f6', opacity: incluida ? 1 : 0.5 }}>
              <div onClick={() => setOpen(o => ({ ...o, [k]: !o[k] }))}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', cursor: 'pointer', background: 'white', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" checked={incluida} onClick={e => e.stopPropagation()} onChange={() => toggle(k)}
                    title="Incluir este día" style={{ width: '15px', height: '15px', cursor: 'pointer' }} />
                  <span style={{ fontWeight: 700, fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>{fmtDia(f.fecha)}</span>
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>{f.lineas.length} ítems</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>{fmtU(f.unidades)} u</span>
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#111827' }}>{fmt(f.total)}</span>
                  <button onClick={e => { e.stopPropagation(); facturarUna(f); }} disabled={!!emitiendoUna || loading}
                    title="Emitir SOLO este día como una factura"
                    style={{ background: '#166534', color: 'white', border: 'none', borderRadius: '5px', padding: '3px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', opacity: emitiendoUna ? 0.6 : 1 }}>
                    {emitiendoUna === k ? 'Emitiendo…' : 'Facturar este día'}
                  </button>
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>{open[k] ? '▲' : '▼'}</span>
                </div>
              </div>
              {open[k] && (
                <table style={{ width: '100%', fontSize: '12px', borderTop: '1px solid #f3f4f6' }}>
                  <thead><tr style={{ background: '#fafafa', color: '#6b7280' }}>
                    <th style={{ textAlign: 'left', padding: '6px 14px' }}>Producto</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Sucursal</th>
                    <th style={{ textAlign: 'right', padding: '6px' }}>Cant.</th>
                    <th style={{ textAlign: 'right', padding: '6px' }}>Precio</th>
                    <th style={{ textAlign: 'right', padding: '6px 14px' }}>Importe</th>
                  </tr></thead>
                  <tbody>
                    {f.lineas.map((l, i) => {
                      const kl = claveLinea(l);
                      const enEdicion = editando === kl;
                      return (
                      <tr key={i} style={{ borderTop: '1px solid #f9fafb' }}>
                        <td style={{ padding: '5px 14px' }}>{l.producto}</td>
                        <td style={{ padding: '5px', color: '#6b7280' }}>{l.sucursal}</td>
                        <td style={{ padding: '5px', textAlign: 'right' }}>
                          {enEdicion ? (
                            <input type="number" min={0} step="any" autoFocus value={valorEdit}
                              onChange={e => setValorEdit(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') guardarLinea(l, Number(valorEdit) || 0);
                                if (e.key === 'Escape') setEditando(null);
                              }}
                              style={{ width: '72px', textAlign: 'right', fontSize: '12px', padding: '2px 5px', border: '1px solid #93c5fd', borderRadius: '4px' }} />
                          ) : (
                            <span onClick={() => { setEditando(kl); setValorEdit(String(l.cantidad)); }}
                              title="Tocá para corregir la cantidad"
                              style={{ cursor: 'pointer', borderBottom: '1px dashed #cbd5e1', padding: '0 2px' }}>
                              {l.cantidad}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right', color: '#6b7280' }}>{fmt(l.precio)}</td>
                        <td style={{ padding: '5px 14px', textAlign: 'right', fontWeight: 600 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                            {fmt(l.importe)}
                            {enEdicion ? (
                              <>
                                <button onClick={() => guardarLinea(l, Number(valorEdit) || 0)} disabled={guardando === kl}
                                  style={{ background: '#166534', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '10.5px', fontWeight: 700, cursor: 'pointer' }}>
                                  {guardando === kl ? '…' : 'Guardar'}
                                </button>
                                <button onClick={() => setEditando(null)} disabled={guardando === kl}
                                  style={{ background: 'none', border: '1px solid #e5e7eb', color: '#6b7280', borderRadius: '4px', padding: '2px 7px', fontSize: '10.5px', cursor: 'pointer' }}>
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <button onClick={() => borrarLinea(l)} disabled={guardando === kl}
                                title="Borrar este renglón de la venta"
                                style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '4px', padding: '1px 6px', fontSize: '10.5px', cursor: 'pointer' }}>
                                ✕
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            );
          })}
        </div>
        );
      })}
    </div>
  );
}
