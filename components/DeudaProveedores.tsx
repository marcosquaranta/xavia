'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DeudaProveedor } from '@/lib/proveedores';

// ── Cuánto le debemos a cada proveedor ───────────────────────────────────────────────
//
// Las compras cargadas como pendientes, agrupadas por proveedor y ordenadas por lo que
// vence antes — que es el orden en el que hay que pagar.
//
// Marcar pagada acá no es un cambio de estado cosmético: le pone al gasto la fecha real del
// pago y el medio por el que salió, y recién ahí entra en el resultado del mes. Si se
// dejara la fecha de la compra, un pago de octubre caería en el resultado de septiembre.

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : '—'; };
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const lbl: React.CSSProperties = { fontSize: '10px', color: '#6b7280', fontWeight: 600, display: 'block' };
const inp: React.CSSProperties = {
  width: '100%', fontSize: '12px', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '5px', marginTop: '2px',
};

export default function DeudaProveedores({ deuda, medios }: { deuda: DeudaProveedor[]; medios: string[] }) {
  const router = useRouter();
  const [pagando, setPagando] = useState<string | null>(null);
  // ── Editar la compra desde acá ──────────────────────────────────────────────────
  //
  // Antes, corregir un vencimiento o el nombre del proveedor era ir a la lista de Gastos,
  // buscar la fila entre cientos y editarla. Y es acá donde se ve que está mal: esta
  // pantalla es la que ordena por vencimiento y la que suma lo vencido, así que es la que
  // delata el dato mal cargado.
  const [editando, setEditando] = useState<string | null>(null);
  const [ed, setEd] = useState<{ descripcion: string; monto: string; proveedor: string; vencimiento: string; fecha: string }>(
    { descripcion: '', monto: '', proveedor: '', vencimiento: '', fecha: '' },
  );
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [medio, setMedio] = useState(medios[0] || '');
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const total = deuda.reduce((a, d) => a + d.total, 0);
  const vencido = deuda.reduce((a, d) => a + d.vencido, 0);

  function abrirEditor(i: DeudaProveedor['items'][number], proveedor: string) {
    if (editando === i.id_gasto) { setEditando(null); return; }
    setEditando(i.id_gasto);
    setMsg(null);
    setEd({
      descripcion: i.descripcion,
      monto: String(Math.round(i.monto)),
      proveedor,
      // Si el vencimiento quedó ilegible, el campo arranca vacío: meterle el texto crudo en
      // un <input type="date" lo deja en blanco igual y hace creer que no había nada.
      vencimiento: i.vencimiento || '',
      fecha: i.fecha || '',
    });
  }

  async function guardarEdicion(id: string, categoria: string, medioPago: string, cantidad: number) {
    const montoNum = Math.round(Number(ed.monto));
    if (!isFinite(montoNum) || montoNum === 0) { setMsg({ ok: false, texto: 'El monto tiene que ser un número distinto de 0.' }); return; }
    if (!ed.descripcion.trim()) { setMsg({ ok: false, texto: 'Poné una descripción.' }); return; }
    setTrabajando(true); setMsg(null);
    try {
      const r = await fetch('/api/gastos/editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_gasto: id,
          // `fecha` es la de la COMPRA y define a qué mes pertenece el costo en el EERR.
          // Se manda la que ya tenía salvo que se la cambie a propósito: ver el comentario
          // de las dos fechas en lib/proveedores.ts.
          fecha: ed.fecha,
          descripcion: ed.descripcion.trim(),
          categoria, monto: montoNum, medio_pago: medioPago,
          cantidad,
          proveedor: ed.proveedor.trim(),
          vencimiento: ed.vencimiento,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'No se pudo guardar.');
      setMsg({ ok: true, texto: '✓ Compra actualizada.' });
      setEditando(null);
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo guardar.' });
    } finally {
      setTrabajando(false);
    }
  }

  async function pagar(id: string) {
    setTrabajando(true); setMsg(null);
    try {
      const r = await fetch('/api/gastos/pagar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: id, fecha_pago: fechaPago, medio_pago: medio }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'No se pudo marcar como pagada.');
      setMsg({ ok: true, texto: '✓ Marcada como pagada.' });
      setPagando(null);
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo marcar como pagada.' });
    } finally {
      setTrabajando(false);
    }
  }

  if (!deuda.length) {
    return <p style={{ margin: 0, fontSize: '13px', color: '#059669' }}>No hay compras pendientes de pago.</p>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <div>
          <p style={{ margin: 0, fontSize: '10.5px', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Se debe</p>
          <strong style={{ fontSize: '20px' }}>{fmt$(total)}</strong>
        </div>
        {vencido > 0 && (
          <div>
            <p style={{ margin: 0, fontSize: '10.5px', color: '#991b1b', textTransform: 'uppercase', fontWeight: 700 }}>Ya vencido</p>
            <strong style={{ fontSize: '20px', color: '#dc2626' }}>{fmt$(vencido)}</strong>
          </div>
        )}
      </div>

      {deuda.map((d) => (
        <div key={d.proveedor} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px' }}>
            <strong style={{ fontSize: '13.5px' }}>{d.proveedor}</strong>
            <span style={{ fontSize: '13.5px', fontWeight: 700 }}>
              {fmt$(d.total)}
              {d.vencido > 0 && <span style={{ color: '#dc2626', fontWeight: 600, fontSize: '11.5px' }}> · {fmt$(d.vencido)} vencido</span>}
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', marginTop: '4px' }}>
            <tbody>
              {d.items.map((i) => {
                const vencidoItem = i.diasParaVencer !== null && i.diasParaVencer < 0;
                return (
                  <Fragment key={i.id_gasto}>
                  <tr style={{ borderTop: '1px solid #f9fafb' }}>
                    <td style={{ padding: '3px 6px', color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDia(i.fecha)}</td>
                    <td style={{ padding: '3px 6px' }}>{i.descripcion}</td>
                    <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', color: vencidoItem ? '#dc2626' : '#6b7280', fontWeight: vencidoItem ? 700 : 400 }}>
                      {/* Tres estados distintos, no dos. “Sin vencimiento” es la celda
                          vacía; “fecha ilegible” es que hay algo escrito que no se puede
                          leer, y eso hay que arreglarlo — mientras tanto la compra no
                          cuenta como vencida y no se ordena. Antes las dos daban
                          “en null d”. */}
                      {i.vencimientoCrudo ? (
                        <span style={{ color: '#dc2626', fontWeight: 700 }}
                          title={`En la planilla dice "${i.vencimientoCrudo}", que no es una fecha. Hasta que se corrija, esta compra no se cuenta como vencida.`}>
                          vencimiento ilegible
                        </span>
                      ) : !i.vencimiento ? <span style={{ color: '#b45309' }}>sin vencimiento</span>
                        : vencidoItem ? `venció hace ${Math.abs(i.diasParaVencer!)} d`
                        : i.diasParaVencer === 0 ? 'vence hoy'
                        : `en ${i.diasParaVencer} d`}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt$(i.monto)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {pagando === i.id_gasto ? (
                        <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)}
                            style={{ fontSize: '11px' }} title="Fecha real del pago" />
                          <select value={medio} onChange={(e) => setMedio(e.target.value)} style={{ fontSize: '11px' }} title="De dónde sale la plata">
                            {medios.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <button type="button" className="btn" style={{ fontSize: '10.5px', padding: '2px 8px' }}
                            onClick={() => pagar(i.id_gasto)} disabled={trabajando || !medio}>
                            {trabajando ? '…' : 'Confirmar'}
                          </button>
                          <button type="button" onClick={() => setPagando(null)} disabled={trabajando}
                            style={{ background: 'none', border: 'none', fontSize: '10.5px', color: '#6b7280', cursor: 'pointer' }}>✕</button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: '4px' }}>
                          <button type="button" onClick={() => abrirEditor(i, d.proveedor)}
                            title="Corregir esta compra"
                            style={{ fontSize: '10.5px', background: 'white', border: '1px solid #e5e7eb', color: '#6b7280', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontWeight: 600 }}>
                            {editando === i.id_gasto ? '▲' : '✎'}
                          </button>
                          <button type="button" onClick={() => { setPagando(i.id_gasto); setFechaPago(hoyISO()); setMsg(null); }}
                            style={{ fontSize: '10.5px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: '4px', padding: '2px 9px', cursor: 'pointer', fontWeight: 600 }}>
                            Pagar
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                  {editando === i.id_gasto && (
                    <tr>
                      <td colSpan={5} style={{ padding: '0 6px 8px' }}>
                        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '7px', padding: '9px 10px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '7px' }}>
                            <label style={lbl}>Descripción
                              <input type="text" value={ed.descripcion} disabled={trabajando}
                                onChange={(e) => setEd((p) => ({ ...p, descripcion: e.target.value }))} style={inp} />
                            </label>
                            <label style={lbl}>Monto
                              <input type="number" value={ed.monto} disabled={trabajando}
                                onChange={(e) => setEd((p) => ({ ...p, monto: e.target.value }))} style={inp} />
                            </label>
                            <label style={lbl}>Proveedor
                              {/* Con lista de los que ya existen: escribir “flhoragro” cuando
                                  ya hay un “FLHORAGRO” es lo que partió este proveedor en dos
                                  tarjetas. Ahora se agrupan igual, pero mejor no crear el
                                  problema de nuevo. */}
                              <input type="text" value={ed.proveedor} disabled={trabajando} list="proveedores-existentes"
                                onChange={(e) => setEd((p) => ({ ...p, proveedor: e.target.value }))} style={inp} />
                            </label>
                            <label style={lbl}>Vence
                              <input type="date" value={ed.vencimiento} disabled={trabajando}
                                onChange={(e) => setEd((p) => ({ ...p, vencimiento: e.target.value }))} style={inp} />
                            </label>
                            <label style={lbl}>Fecha de la compra
                              <input type="date" value={ed.fecha} disabled={trabajando}
                                onChange={(e) => setEd((p) => ({ ...p, fecha: e.target.value }))} style={inp} />
                            </label>
                          </div>
                          <div style={{ display: 'flex', gap: '7px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button type="button" className="btn" style={{ fontSize: '11px', padding: '4px 12px' }}
                              disabled={trabajando}
                              onClick={() => guardarEdicion(i.id_gasto, i.categoria || 'gastos_generales', i.medioPago || '', i.cantidad || 0)}>
                              {trabajando ? 'Guardando…' : 'Guardar'}
                            </button>
                            <button type="button" onClick={() => setEditando(null)} disabled={trabajando}
                              style={{ fontSize: '11px', padding: '4px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer', color: '#6b7280' }}>
                              Cancelar
                            </button>
                            {i.vencimientoCrudo && (
                              <span style={{ fontSize: '11px', color: '#dc2626' }}>
                                En la planilla dice “{i.vencimientoCrudo}”, que no es una fecha.
                              </span>
                            )}
                          </div>
                          {/* Qué cambia cada fecha. Son dos y se confunden: mover la de la
                              compra saca el costo de un mes y lo mete en otro. */}
                          <p style={{ margin: '7px 0 0', fontSize: '10.5px', color: '#9ca3af', lineHeight: 1.5 }}>
                            <strong>Vence</strong> es cuándo hay que pagarla y solo ordena esta lista.
                            <strong> Fecha de la compra</strong> define a qué mes pertenece el costo en el resultado:
                            cambiarla lo saca de un mes y lo mete en otro. La fecha del pago se pone al marcarla pagada.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <datalist id="proveedores-existentes">
        {deuda.map((x) => <option key={x.proveedor} value={x.proveedor} />)}
      </datalist>

      {msg && <p style={{ margin: '8px 0 0', fontSize: '12.5px', fontWeight: 600, color: msg.ok ? '#059669' : '#dc2626' }}>{msg.texto}</p>}

      <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: '#9ca3af', lineHeight: 1.5 }}>
        Estas compras todavía no cuentan como gasto: la plata no salió. Al marcarlas pagadas se les pone la fecha
        real del pago y recién ahí entran en el resultado del mes.
      </p>
    </div>
  );
}
