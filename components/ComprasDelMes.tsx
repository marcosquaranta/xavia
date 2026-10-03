'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Qué se compró este mes ───────────────────────────────────────────────────────────
//
// Las compras ya estaban cargadas —son los gastos que tienen un artículo asociado— pero no
// había dónde verlas juntas: para chequear el mes había que recorrer la lista de gastos
// entera mezclada con alquiler, sueldos y combustible.
//
// El precio unitario no se guarda: sale de dividir el monto por la cantidad. Es a propósito.
// Si se guardara aparte, al corregir el monto de una compra el unitario quedaría viejo y
// habría dos números que dicen cosas distintas sobre lo mismo.

export interface CompraUI {
  id_gasto: string;
  fecha: string;
  descripcion: string;
  id_articulo: string;
  articuloNombre: string;
  unidad: string;
  cantidad: number;
  monto: number;
  medio_pago: string;
  categoria: string;
}

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtN = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const fmtDia = (f: string) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : f; };
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function ComprasDelMes({ compras, anioActual, mesActual }: {
  compras: CompraUI[];
  anioActual: number;
  mesActual: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [anio, setAnio] = useState(anioActual);
  const [mes, setMes] = useState(mesActual);
  const [editando, setEditando] = useState<string | null>(null);
  const [vals, setVals] = useState<{ cantidad: string; monto: string; descripcion: string }>({ cantidad: '', monto: '', descripcion: '' });
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const delMes = useMemo(() => {
    const ini = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const finDia = new Date(anio, mes, 0).getDate();
    const fin = `${anio}-${String(mes).padStart(2, '0')}-${String(finDia).padStart(2, '0')}`;
    return compras
      .filter((c) => c.fecha >= ini && c.fecha <= fin)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.articuloNombre.localeCompare(b.articuloNombre));
  }, [compras, anio, mes]);

  const total = delMes.reduce((a, c) => a + c.monto, 0);

  // Lo mismo agrupado por artículo: comprar tres veces el mismo insumo en el mes es normal,
  // y el total por artículo es lo que se compara contra el consumo.
  const porArticulo = useMemo(() => {
    const map = new Map<string, { nombre: string; unidad: string; cantidad: number; monto: number; veces: number }>();
    for (const c of delMes) {
      const k = c.id_articulo || c.articuloNombre;
      const prev = map.get(k) || { nombre: c.articuloNombre, unidad: c.unidad, cantidad: 0, monto: 0, veces: 0 };
      prev.cantidad += c.cantidad;
      prev.monto += c.monto;
      prev.veces += 1;
      map.set(k, prev);
    }
    return [...map.values()].sort((a, b) => b.monto - a.monto);
  }, [delMes]);

  function mover(n: number) {
    let m = mes + n, a = anio;
    if (m < 1) { m = 12; a--; }
    if (m > 12) { m = 1; a++; }
    // No se navega al futuro: un mes que todavía no empezó no tiene compras que mirar.
    if (a > anioActual || (a === anioActual && m > mesActual)) return;
    setMes(m); setAnio(a); setEditando(null); setMsg(null);
  }

  function empezar(c: CompraUI) {
    setEditando(c.id_gasto);
    setVals({ cantidad: String(c.cantidad || ''), monto: String(c.monto || ''), descripcion: c.descripcion });
    setMsg(null);
  }

  async function guardar(c: CompraUI) {
    setGuardando(true); setMsg(null);
    try {
      const r = await fetch('/api/gastos/editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_gasto: c.id_gasto,
          fecha: c.fecha,
          descripcion: vals.descripcion,
          categoria: c.categoria,
          monto: Number(vals.monto) || 0,
          medio_pago: c.medio_pago,
          cantidad: Number(vals.cantidad) || 0,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'No se pudo guardar.');
      setMsg({ ok: true, texto: '✓ Compra actualizada.' });
      setEditando(null);
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo guardar.' });
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <div className="card" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <p className="card-title" style={{ margin: 0 }}>Compras del mes</p>
          <p className="card-sub" style={{ margin: '2px 0 0' }}>Qué insumos se compraron, en qué cantidad y a qué precio.</p>
        </div>
        <button type="button" className="btn secondary" style={{ fontSize: '13px' }} onClick={() => setAbierto(true)}>Ver →</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <p className="card-title" style={{ margin: 0 }}>Compras del mes</p>
        <button type="button" onClick={() => setAbierto(false)} style={{ background: 'none', border: 'none', fontSize: '12px', color: '#2563eb', cursor: 'pointer' }}>Ocultar</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '10px 0', flexWrap: 'wrap' }}>
        <button type="button" className="btn secondary" style={{ fontSize: '12px' }} onClick={() => mover(-1)}>← Anterior</button>
        <span style={{ fontWeight: 700, fontSize: '14px' }}>{MESES[mes - 1]} {anio}</span>
        <button type="button" className="btn secondary" style={{ fontSize: '12px' }} onClick={() => mover(1)}
          disabled={anio === anioActual && mes === mesActual}>Siguiente →</button>
        <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: 700 }}>
          {delMes.length} {delMes.length === 1 ? 'compra' : 'compras'} · {fmt$(total)}
        </span>
      </div>

      {delMes.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
          No hay compras de insumos cargadas en este mes. Se cargan desde Gastos, eligiendo el artículo y la cantidad.
        </p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '620px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', color: '#6b7280', fontSize: '11.5px' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Fecha</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Artículo</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Cantidad</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>$ / unidad</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {delMes.map((c) => {
                  const edit = editando === c.id_gasto;
                  const cantidad = edit ? Number(vals.cantidad) || 0 : c.cantidad;
                  const monto = edit ? Number(vals.monto) || 0 : c.monto;
                  // Dividido, no guardado: ver el comentario de arriba.
                  const unitario = cantidad > 0 ? monto / cantidad : null;
                  return (
                    <tr key={c.id_gasto} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '5px 8px', color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDia(c.fecha)}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={{ fontWeight: 600 }}>{c.articuloNombre}</span>
                        {edit ? (
                          <input value={vals.descripcion} onChange={(e) => setVals((v) => ({ ...v, descripcion: e.target.value }))}
                            style={{ display: 'block', width: '100%', fontSize: '11.5px', marginTop: '2px' }} />
                        ) : c.descripcion ? (
                          <span style={{ display: 'block', fontSize: '11px', color: '#9ca3af' }}>{c.descripcion}</span>
                        ) : null}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {edit ? (
                          <input type="number" min={0} step="any" value={vals.cantidad}
                            onChange={(e) => setVals((v) => ({ ...v, cantidad: e.target.value }))}
                            style={{ width: '80px', textAlign: 'right', fontSize: '12px' }} />
                        ) : (
                          <>{c.cantidad > 0 ? fmtN(c.cantidad) : <span style={{ color: '#d1d5db' }}>—</span>} <span style={{ color: '#9ca3af', fontSize: '11px' }}>{c.unidad}</span></>
                        )}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: '#6b7280', whiteSpace: 'nowrap' }}>
                        {unitario === null ? <span style={{ color: '#d1d5db' }}>—</span> : fmt$(unitario)}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {edit ? (
                          <input type="number" min={0} step="any" value={vals.monto}
                            onChange={(e) => setVals((v) => ({ ...v, monto: e.target.value }))}
                            style={{ width: '100px', textAlign: 'right', fontSize: '12px' }} />
                        ) : fmt$(c.monto)}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {edit ? (
                          <>
                            <button type="button" className="btn" style={{ fontSize: '11px', padding: '3px 10px' }} onClick={() => guardar(c)} disabled={guardando}>
                              {guardando ? '…' : 'Guardar'}
                            </button>
                            <button type="button" onClick={() => setEditando(null)} disabled={guardando}
                              style={{ marginLeft: '5px', background: 'none', border: 'none', fontSize: '11px', color: '#6b7280', cursor: 'pointer' }}>Cancelar</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => empezar(c)}
                            style={{ fontSize: '11px', background: 'none', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 9px', cursor: 'pointer' }}>Editar</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* El mismo mes agrupado: es lo que se compara contra el consumo del artículo. */}
          {porArticulo.length > 1 && (
            <div style={{ marginTop: '14px', borderTop: '1px solid #f3f4f6', paddingTop: '10px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '11.5px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Total por artículo</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <tbody>
                  {porArticulo.map((a) => (
                    <tr key={a.nombre} style={{ borderTop: '1px solid #f9fafb' }}>
                      <td style={{ padding: '4px 8px' }}>{a.nombre}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', color: '#6b7280' }}>
                        {fmtN(a.cantidad)} {a.unidad}
                        {a.veces > 1 && <span style={{ color: '#9ca3af', fontSize: '11px' }}> · {a.veces} compras</span>}
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', color: '#6b7280' }}>
                        {a.cantidad > 0 ? `${fmt$(a.monto / a.cantidad)} / ${a.unidad || 'u'}` : ''}
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700 }}>{fmt$(a.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {msg && (
        <p style={{ margin: '10px 0 0', fontSize: '12.5px', fontWeight: 600, color: msg.ok ? '#059669' : '#dc2626' }}>{msg.texto}</p>
      )}
    </div>
  );
}
