'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORIAS_GASTO, type Gasto, type CategoriaGasto, type Articulo } from '@/lib/types';
import NumberInput from '@/components/NumberInput';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MEDIOS = ['Brubank', 'Macro', 'Caja MQ'] as const;
const LABEL_CAT: Record<string, string> = Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c.value, c.label]));
const ORDEN_CAT: CategoriaGasto[] = CATEGORIAS_GASTO.map((c) => c.value);
const HOY = new Date();
const hoyISO = () => HOY.toISOString().split('T')[0];
const fmtMoneda = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtFecha = (s: string) => { const [y, m, d] = String(s || '').split(/[T ]/)[0].split('-'); return d && m ? `${d}/${m}` : s; };

interface Props { gastos: Gasto[]; articulos: Articulo[]; usuario: string }

export default function GastosManager({ gastos, articulos, usuario }: Props) {
  const router = useRouter();
  const [anio, setAnio] = useState(HOY.getFullYear());
  const [mes, setMes] = useState(HOY.getMonth() + 1);

  // Alta
  const [fecha, setFecha] = useState(hoyISO());
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState<CategoriaGasto>('gastos_generales');
  const [monto, setMonto] = useState(0);
  const [medioPago, setMedioPago] = useState<string>(MEDIOS[0]);
  const [idArticulo, setIdArticulo] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoriasArticulo = useMemo(() => Array.from(new Set(articulos.map((a) => a.categoria))).sort(), [articulos]);
  const precioUnitarioCalc = monto > 0 && Number(cantidad) > 0 ? monto / Number(cantidad) : null;

  // Edición inline
  const [editId, setEditId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<{ fecha: string; descripcion: string; categoria: CategoriaGasto; monto: number; medio_pago: string } | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [msgExport, setMsgExport] = useState<string | null>(null);

  const delMes = useMemo(() => {
    const ini = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const finDia = new Date(anio, mes, 0).getDate();
    const fin = `${anio}-${String(mes).padStart(2, '0')}-${String(finDia).padStart(2, '0')}`;
    return gastos.filter((g) => { const f = String(g.fecha || '').split(/[T ]/)[0]; return f >= ini && f <= fin; });
  }, [gastos, anio, mes]);

  const porCategoria = useMemo(() => {
    return ORDEN_CAT.map((cat) => ({
      cat, items: delMes.filter((g) => g.categoria === cat).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
    })).filter((g) => g.items.length > 0);
  }, [delMes]);

  const totalGeneral = delMes.reduce((a, g) => a + (Number(g.monto) || 0), 0);
  const totalesPorMedio = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of delMes) map.set(g.medio_pago, (map.get(g.medio_pago) || 0) + (Number(g.monto) || 0));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [delMes]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!descripcion.trim()) { setError('Ingresá una descripción'); return; }
    if (monto <= 0) { setError('Ingresá un monto mayor a 0'); return; }
    setGuardando(true);
    try {
      const res = await fetch('/api/gastos/nuevo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha, descripcion, categoria, monto, medio_pago: medioPago,
          ...(categoria === 'insumos' ? { id_articulo: idArticulo, cantidad } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Error al guardar');
      setDescripcion(''); setMonto(0); setFecha(hoyISO()); setCategoria('gastos_generales'); setMedioPago(MEDIOS[0]);
      setIdArticulo(''); setCantidad('');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  function empezarEdicion(g: Gasto) {
    setEditId(g.id_gasto);
    setEditVals({ fecha: String(g.fecha).split(/[T ]/)[0], descripcion: g.descripcion, categoria: g.categoria, monto: Number(g.monto) || 0, medio_pago: g.medio_pago });
  }

  async function guardarEdicion() {
    if (!editId || !editVals) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/gastos/editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: editId, ...editVals }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Error al guardar');
      setEditId(null); setEditVals(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    if (!confirm('¿Eliminar este gasto?')) return;
    setBorrando(id);
    try {
      await fetch('/api/gastos/borrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_gasto: id }) });
      router.refresh();
    } catch {} finally { setBorrando(null); }
  }

  async function exportar() {
    setExportando(true); setMsgExport(null);
    try {
      const res = await fetch('/api/gastos/exportar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anio, mes }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Error al exportar');
      const bytes = Uint8Array.from(atob(j.file), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes]));
      const a = document.createElement('a'); a.href = url; a.download = j.filename; a.click(); URL.revokeObjectURL(url);
    } catch (err: any) {
      setMsgExport('Error: ' + (err.message || 'no se pudo exportar'));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div>
      {/* ══ Alta de gasto ══ */}
      <form onSubmit={agregar} className="card" style={{ marginBottom: '14px' }}>
        <p className="card-title">Nuevo gasto</p>
        {error && <div className="alert-box error" style={{ marginBottom: '10px' }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '12px' }}>
          <div>
            <label>Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={guardando} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label>Descripción</label>
            <input type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: Compra de cubos Oasis" disabled={guardando} />
          </div>
          <div>
            <label>Categoría</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaGasto)} disabled={guardando}>
              {CATEGORIAS_GASTO.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label>Monto</label>
            <NumberInput value={monto} onChange={setMonto} min={0} disabled={guardando} placeholder="0" />
          </div>
          <div>
            <label>Medio de pago</label>
            <select value={medioPago} onChange={(e) => setMedioPago(e.target.value)} disabled={guardando}>
              {MEDIOS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {categoria === 'insumos' && (
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
              Detalle del insumo (opcional, pero acelera la carga en Stocks)
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              <div>
                <label>Artículo</label>
                <select value={idArticulo} onChange={(e) => setIdArticulo(e.target.value)} disabled={guardando}>
                  <option value="">— sin especificar —</option>
                  {categoriasArticulo.map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {articulos.filter((a) => a.categoria === cat).map((a) => (
                        <option key={a.id_articulo} value={a.id_articulo}>{a.articulo}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label>Cantidad comprada</label>
                <input type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} min={0} step={0.001} disabled={guardando} placeholder="Ej: 50" />
              </div>
              <div>
                <label style={{ color: '#9ca3af' }}>Precio unitario (calculado)</label>
                <p style={{ margin: 0, padding: '7px 0', fontSize: '14px', fontWeight: 700, color: precioUnitarioCalc !== null ? '#111827' : '#d1d5db' }}>
                  {precioUnitarioCalc !== null ? fmtMoneda(precioUnitarioCalc) : '—'}
                </p>
              </div>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af' }}>
              Si completás artículo y cantidad, la sugerencia de compra en Stocks queda pre-cargada y lista para confirmar en un click.
            </p>
          </div>
        )}

        <button type="submit" className="btn" disabled={guardando}>{guardando ? 'Guardando…' : '+ Agregar gasto'}</button>
      </form>

      {/* ══ Selector de mes + export ══ */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ width: '90px' }}>
          {[2024, 2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}
        </select>
        <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={{ width: '130px' }}>
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <button onClick={exportar} className="btn secondary" disabled={exportando || !delMes.length} style={{ fontSize: '12px' }}>
          {exportando ? 'Exportando…' : '⬇ Exportar mes (Excel)'}
        </button>
        {msgExport && <span style={{ fontSize: '12px', color: '#dc2626' }}>{msgExport}</span>}
      </div>

      {/* ══ Totales del mes ══ */}
      {delMes.length > 0 && (
        <div className="card" style={{ marginBottom: '14px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Totales — {MESES[mes - 1]} {anio}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            {totalesPorMedio.map(([medio, total]) => (
              <div key={medio} style={{ background: '#f9fafb', borderRadius: '7px', padding: '10px 12px' }}>
                <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#6b7280', textTransform: 'uppercase' }}>{medio}</p>
                <p style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>{fmtMoneda(total)}</p>
              </div>
            ))}
            <div style={{ background: '#111827', borderRadius: '7px', padding: '10px 12px' }}>
              <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#d1d5db', textTransform: 'uppercase' }}>Total general</p>
              <p style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'white' }}>{fmtMoneda(totalGeneral)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ══ Listado por categoría ══ */}
      {porCategoria.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>Sin gastos cargados en {MESES[mes - 1]} {anio}.</div>
      ) : porCategoria.map(({ cat, items }) => {
        const subtotal = items.reduce((a, g) => a + (Number(g.monto) || 0), 0);
        return (
          <div key={cat} className="card" style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>{LABEL_CAT[cat] || cat}</p>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#059669' }}>{fmtMoneda(subtotal)}</span>
            </div>
            <table style={{ fontSize: '12px', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', width: '60px' }}>Fecha</th>
                  <th style={{ textAlign: 'left' }}>Descripción</th>
                  <th style={{ textAlign: 'left', width: '120px' }}>Medio de pago</th>
                  <th style={{ textAlign: 'right', width: '110px' }}>Monto</th>
                  <th style={{ width: '70px' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((g) => {
                  const editando = editId === g.id_gasto;
                  if (editando && editVals) {
                    return (
                      <tr key={g.id_gasto} style={{ background: '#fefce8' }}>
                        <td style={{ padding: '2px 4px' }}><input type="date" value={editVals.fecha} onChange={(e) => setEditVals({ ...editVals, fecha: e.target.value })} style={{ fontSize: '11px', padding: '3px' }} /></td>
                        <td style={{ padding: '2px 4px' }}><input type="text" value={editVals.descripcion} onChange={(e) => setEditVals({ ...editVals, descripcion: e.target.value })} style={{ width: '100%', fontSize: '12px', padding: '3px 6px', border: '1px solid #e5e7eb', borderRadius: '4px' }} /></td>
                        <td style={{ padding: '2px 4px' }}>
                          <select value={editVals.medio_pago} onChange={(e) => setEditVals({ ...editVals, medio_pago: e.target.value })} style={{ fontSize: '11px', padding: '3px' }}>
                            {MEDIOS.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '2px 4px' }}>
                          <input type="number" value={editVals.monto} onChange={(e) => setEditVals({ ...editVals, monto: Number(e.target.value) || 0 })} style={{ width: '100%', textAlign: 'right', fontSize: '12px', padding: '3px 6px', border: '1px solid #e5e7eb', borderRadius: '4px' }} min={0} step={0.01} />
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button onClick={guardarEdicion} disabled={guardando} style={{ background: '#059669', color: 'white', border: 'none', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', cursor: 'pointer', marginRight: '3px' }}>✓</button>
                          <button onClick={() => { setEditId(null); setEditVals(null); }} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '11px' }}>✕</button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={g.id_gasto}>
                      <td>{fmtFecha(g.fecha)}</td>
                      <td>{g.descripcion}</td>
                      <td style={{ color: '#6b7280' }}>{g.medio_pago}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoneda(Number(g.monto) || 0)}</td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button onClick={() => empezarEdicion(g)} title="Editar" style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '12px', marginRight: '4px' }}>✎</button>
                        <button onClick={() => borrar(g.id_gasto)} title="Eliminar" disabled={borrando === g.id_gasto} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '13px' }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
