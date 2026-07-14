'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Articulo, StockMes, Lote, VentaDia, PrecioVenta, ClienteVenta, Gasto } from '@/lib/types';
import { calcularDriversMes, calcularUsoTeorico, DRIVERS } from '@/lib/usoTeorico';
import { matchArticuloPorTexto } from '@/lib/matchArticulo';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const HOY = new Date();

interface Props {
  articulos: Articulo[]; stocks: StockMes[]; lotes: Lote[];
  ventas: VentaDia[]; precios: PrecioVenta[]; clientes: ClienteVenta[];
  gastosSugeridos: Gasto[]; usuario: string;
}

function num(v: any) { const n = Number(v); return isNaN(n) ? 0 : n; }

// ══ Carga masiva (Compras o Stock final): pegar filas "Artículo <tab/coma/espacios> Cantidad" ══
function parseNumero(s: string): number {
  let t = String(s || '').trim().replace(/[^\d.,-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = parseFloat(t);
  return isNaN(n) ? NaN : n;
}
interface FilaPreview { linea: string; nombreDetectado: string; cantidad: number; id_articulo: string }
function parsearPegado(texto: string, articulos: Articulo[]): FilaPreview[] {
  const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  return lineas.map((linea) => {
    let partes = linea.split('\t').map((s) => s.trim()).filter(Boolean);
    if (partes.length < 2) partes = linea.split(',').map((s) => s.trim()).filter(Boolean);
    if (partes.length < 2) partes = linea.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    let nombreRaw = '', cantidadRaw = '';
    if (partes.length >= 2) {
      cantidadRaw = partes[partes.length - 1];
      nombreRaw = partes.slice(0, -1).join(' ');
    } else {
      const m = /^(.*?)[\s:–-]+([\d.,]+)\s*$/.exec(linea);
      if (m) { nombreRaw = m[1]; cantidadRaw = m[2]; } else { nombreRaw = linea; }
    }
    const cantidad = parseNumero(cantidadRaw);
    const art = matchArticuloPorTexto(nombreRaw, articulos);
    return { linea, nombreDetectado: nombreRaw, cantidad: isNaN(cantidad) ? 0 : cantidad, id_articulo: art?.id_articulo || '' };
  });
}

function fmt(n: number, maxFrac = 3) { return n.toLocaleString('es-AR', { maximumFractionDigits: maxFrac }); }

export default function StocksManager({ articulos, stocks, lotes, ventas, precios, clientes, gastosSugeridos, usuario }: Props) {
  const router = useRouter();
  const [anio, setAnio] = useState(HOY.getFullYear());
  const [mes, setMes] = useState(HOY.getMonth() + 1);
  const [vista, setVista] = useState<'carga' | 'informe'>('carga');
  const [saving, setSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, { ini: string; comp: string; fin: string; precio: string; notas: string }>>({});
  const [mostrarUsos, setMostrarUsos] = useState(false);

  // Carga masiva de compras / stock final
  const [mostrarCarga, setMostrarCarga] = useState(false);
  const [campoCarga, setCampoCarga] = useState<'compras' | 'stock_final'>('compras');
  const [pegado, setPegado] = useState('');
  const [filasCarga, setFilasCarga] = useState<FilaPreview[] | null>(null);
  const [guardandoMasivo, setGuardandoMasivo] = useState(false);
  const [resultadoMasivo, setResultadoMasivo] = useState<string | null>(null);

  function analizarPegado() {
    setFilasCarga(parsearPegado(pegado, artActivos));
    setResultadoMasivo(null);
  }
  function actualizarFilaCarga(i: number, patch: Partial<FilaPreview>) {
    setFilasCarga((prev) => prev ? prev.map((f, j) => j === i ? { ...f, ...patch } : f) : prev);
  }
  function quitarFilaCarga(i: number) {
    setFilasCarga((prev) => prev ? prev.filter((_, j) => j !== i) : prev);
  }
  async function confirmarCargaMasiva() {
    if (!filasCarga) return;
    const items = filasCarga.filter((f) => f.id_articulo && f.cantidad >= 0).map((f) => ({ id_articulo: f.id_articulo, compras: f.cantidad }));
    if (!items.length) return;
    setGuardandoMasivo(true);
    try {
      const res = await fetch('/api/stocks/compras-masivas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anio, mes, items, campo: campoCarga }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Error');
      setResultadoMasivo(`✓ ${j.actualizados} actualizados, ${j.creados} nuevos.`);
      setFilasCarga(null); setPegado('');
      router.refresh();
    } catch (err: any) {
      setResultadoMasivo('Error: ' + (err.message || 'no se pudo guardar'));
    } finally {
      setGuardandoMasivo(false);
    }
  }

  const categorias = useMemo(() => Array.from(new Set(articulos.map((a) => a.categoria))).sort(), [articulos]);

  // Drivers de producción/ventas del mes seleccionado — alimentan el Uso Teórico configurado por artículo.
  const drivers = useMemo(() => calcularDriversMes(lotes, ventas, precios, clientes, anio, mes), [lotes, ventas, precios, clientes, anio, mes]);

  // Stock del mes seleccionado
  const stockMes = useMemo(() =>
    stocks.filter((s) => String(s.anio) === String(anio) && String(s.mes) === String(mes)),
    [stocks, anio, mes]
  );

  function getStock(id_articulo: string) {
    return stockMes.find((s) => s.id_articulo === id_articulo);
  }

  function getEdit(id: string) {
    const s = getStock(id);
    if (editValues[id]) return editValues[id];
    if (s) return { ini: String(num(s.stock_inicial)), comp: String(num(s.compras)), fin: String(num(s.stock_final)), precio: num(s.precio_unitario) > 0 ? String(num(s.precio_unitario)) : '', notas: s.notas || '' };
    // Sin registro: pre-completar stock inicial = stock final del mes anterior
    let mesPrev = mes - 1, anioPrev = anio;
    if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
    const sPrev = stocks.find((st) => st.id_articulo === id && String(st.anio) === String(anioPrev) && String(st.mes) === String(mesPrev));
    const iniAuto = sPrev && num(sPrev.stock_final) > 0 ? String(num(sPrev.stock_final)) : '';
    return { ini: iniAuto, comp: '', fin: '', precio: '', notas: '' };
  }

  // Último precio de compra conocido de un artículo, a la fecha del mes visualizado
  // (o antes) — usa el valor recién tipeado en pantalla si lo hay, si no busca hacia
  // atrás en Stocks el registro más reciente con precio_unitario cargado.
  function precioUltimoConocido(id_articulo: string, precioTipeado?: number): number | null {
    if (precioTipeado && precioTipeado > 0) return precioTipeado;
    const claveActual = anio * 12 + mes;
    const candidatos = stocks.filter((s) =>
      s.id_articulo === id_articulo && num(s.precio_unitario) > 0 && (Number(s.anio) * 12 + Number(s.mes)) <= claveActual
    );
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => (Number(a.anio) * 12 + Number(a.mes)) - (Number(b.anio) * 12 + Number(b.mes)));
    return num(candidatos[candidatos.length - 1].precio_unitario);
  }

  function setField(id: string, field: string, val: string) {
    const cur = getEdit(id);
    setEditValues((prev) => ({ ...prev, [id]: { ...cur, [field]: val } }));
  }

  async function guardar(art: Articulo) {
    setSaving(art.id_articulo);
    const vals = getEdit(art.id_articulo);
    try {
      await fetch('/api/stocks/guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_articulo: art.id_articulo, anio, mes,
          stock_inicial: vals.ini, compras: vals.comp,
          stock_final: vals.fin, precio_unitario: vals.precio, notas: vals.notas,
        }),
      });
      setEditValues((prev) => { const n = { ...prev }; delete n[art.id_articulo]; return n; });
      router.refresh();
    } catch {}
    setSaving(null);
  }

  // Informe: últimos 6 meses por artículo
  function getMesesAnteriores() {
    const meses: { anio: number; mes: number; label: string }[] = [];
    let a = anio, m = mes;
    for (let i = 0; i < 6; i++) {
      meses.unshift({ anio: a, mes: m, label: MESES[m - 1].slice(0, 3) + ' ' + a });
      m--; if (m === 0) { m = 12; a--; }
    }
    return meses;
  }

  const mesesInforme = getMesesAnteriores();

  function getUso(id_articulo: string, a: number, m: number) {
    const s = stocks.find((s) => s.id_articulo === id_articulo && String(s.anio) === String(a) && String(s.mes) === String(m));
    if (!s) return null;
    return num(s.uso_calculado);
  }

  const artActivos = articulos.filter((a) => a.activo === 'SI');

  // Resumen real/teórico/diferencia por artículo para el mes seleccionado — reutilizado
  // por la tabla principal y por la vista consolidada.
  const resumenArticulos = useMemo(() => {
    return artActivos.map((art) => {
      const vals = getEdit(art.id_articulo);
      const ini = num(vals.ini), comp = num(vals.comp), fin = num(vals.fin);
      const usoReal = ini + comp - fin;
      const usoTeorico = calcularUsoTeorico(art.formula_uso, Number(art.factor_uso) || 0, drivers);
      const diff = usoTeorico !== null ? usoReal - usoTeorico : null;
      const pct = usoTeorico !== null && usoTeorico !== 0 ? (diff! / usoTeorico) * 100 : null;
      const precio = precioUltimoConocido(art.id_articulo, num(vals.precio));
      const valorizado = precio !== null ? fin * precio : null;
      return { art, ini, comp, fin, usoReal, usoTeorico, diff, pct, precio, valorizado };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artActivos, editValues, stockMes, drivers, stocks, anio, mes]);

  // Vista consolidada del mes
  const consolidado = useMemo(() => {
    const conFormula = resumenArticulos.filter((r) => r.usoTeorico !== null && (r.ini || r.comp || r.fin));
    const rojos = conFormula.filter((r) => (r.diff ?? 0) > 0);
    const verdes = conFormula.filter((r) => (r.diff ?? 0) <= 0);
    const top = [...conFormula].filter((r) => r.pct !== null).sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!)).slice(0, 3);
    const valorizacionTotal = resumenArticulos.reduce((acc, r) => acc + (r.valorizado ?? 0), 0);
    const sinPrecio = resumenArticulos.filter((r) => r.fin > 0 && r.precio === null).length;
    return {
      total: conFormula.length, rojos: rojos.length, verdes: verdes.length, top,
      sinConfigurar: artActivos.filter((a) => !a.formula_uso).length,
      valorizacionTotal, sinPrecio,
    };
  }, [resumenArticulos, artActivos]);

  // Gastos "insumos" del mes seleccionado, aún no aplicados — sugerencia de compra.
  const [matchOverride, setMatchOverride] = useState<Record<string, string>>({});
  const [cantidadGasto, setCantidadGasto] = useState<Record<string, string>>({});
  const [procesandoGasto, setProcesandoGasto] = useState<string | null>(null);
  const gastosDelMes = useMemo(() => {
    return gastosSugeridos.filter((g) => {
      const f = String(g.fecha || '').split(/[T ]/)[0];
      const [gy, gm] = f.split('-').map(Number);
      return gy === anio && gm === mes;
    });
  }, [gastosSugeridos, anio, mes]);

  async function confirmarGasto(g: Gasto, idArticulo: string) {
    const cant = Number(cantidadGasto[g.id_gasto]);
    if (!idArticulo || !(cant > 0)) return;
    setProcesandoGasto(g.id_gasto);
    try {
      await fetch('/api/stocks/gastos-aplicar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: g.id_gasto, id_articulo: idArticulo, anio, mes, cantidad: cant }),
      });
      router.refresh();
    } catch {}
    setProcesandoGasto(null);
  }
  async function descartarGasto(g: Gasto) {
    setProcesandoGasto(g.id_gasto);
    try {
      await fetch('/api/stocks/gastos-aplicar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: g.id_gasto, descartar: true }),
      });
      router.refresh();
    } catch {}
    setProcesandoGasto(null);
  }

  return (
    <div>
      {/* Selector de mes y vista */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ width: '90px' }}>
          {[2024, 2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}
        </select>
        <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={{ width: '130px' }}>
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => setVista('carga')} className={vista === 'carga' ? 'btn' : 'btn secondary'} style={{ fontSize: '12px' }}>
            Carga mensual
          </button>
          <button onClick={() => setVista('informe')} className={vista === 'informe' ? 'btn' : 'btn secondary'} style={{ fontSize: '12px' }}>
            Informe comparativo
          </button>
        </div>
        {vista === 'carga' && (
          <button onClick={() => { setMostrarCarga((v) => !v); setResultadoMasivo(null); }} className="btn secondary" style={{ fontSize: '12px' }}>
            📋 Carga masiva
          </button>
        )}
      </div>

      {/* ===== VISTA: CARGA MENSUAL ===== */}
      {vista === 'carga' && (
        <div>
          {/* Vista consolidada del mes */}
          <div className="card" style={{ marginBottom: '12px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Resumen del mes — {MESES[mes - 1]} {anio}
            </p>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '22px', fontWeight: 800, color: '#dc2626' }}>{consolidado.rojos}</span>
                <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '6px' }}>por encima del teórico</span>
              </div>
              <div>
                <span style={{ fontSize: '22px', fontWeight: 800, color: '#059669' }}>{consolidado.verdes}</span>
                <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '6px' }}>en línea o por debajo</span>
              </div>
              <div>
                <span style={{ fontSize: '22px', fontWeight: 800, color: '#111827' }}>${fmt(consolidado.valorizacionTotal, 0)}</span>
                <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '6px' }}>stock final valorizado</span>
              </div>
              {consolidado.sinConfigurar > 0 && (
                <div>
                  <span style={{ fontSize: '13px', color: '#9ca3af' }}>{consolidado.sinConfigurar} artículo(s) sin fórmula configurada</span>
                </div>
              )}
            </div>
            {consolidado.sinPrecio > 0 && (
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af' }}>
                {consolidado.sinPrecio} artículo(s) con stock final pero sin precio de compra cargado aún — no entran en la valorización.
              </p>
            )}
            {consolidado.top.length > 0 && (
              <div style={{ marginTop: '10px', borderTop: '1px solid #f3f4f6', paddingTop: '8px' }}>
                <p style={{ margin: '0 0 4px', fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase' }}>Mayores desvíos</p>
                {consolidado.top.map((r) => (
                  <p key={r.art.id_articulo} style={{ margin: '2px 0', fontSize: '12px' }}>
                    <span style={{ fontWeight: 500 }}>{r.art.articulo}</span>{' '}
                    <span style={{ color: (r.diff ?? 0) > 0 ? '#dc2626' : '#059669', fontWeight: 700 }}>
                      {(r.pct ?? 0) > 0 ? '+' : ''}{fmt(r.pct ?? 0, 0)}%
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Sugerencias de compra desde Gastos */}
          {gastosDelMes.length > 0 && (
            <div className="card" style={{ marginBottom: '12px', border: '1px solid #fde68a', background: '#fffbeb' }}>
              <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 700 }}>Sugerencias de compra desde Gastos — {gastosDelMes.length} pendiente(s)</p>
              <table style={{ fontSize: '12px', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Fecha</th>
                    <th style={{ textAlign: 'left' }}>Descripción</th>
                    <th style={{ textAlign: 'right', width: '90px' }}>Monto</th>
                    <th style={{ textAlign: 'left', width: '200px' }}>Artículo</th>
                    <th style={{ textAlign: 'right', width: '100px' }}>Cantidad</th>
                    <th style={{ width: '140px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {gastosDelMes.map((g) => {
                    const matchAuto = matchArticuloPorTexto(g.descripcion, artActivos);
                    const idSel = matchOverride[g.id_gasto] ?? (matchAuto?.id_articulo || '');
                    return (
                      <tr key={g.id_gasto}>
                        <td style={{ color: '#6b7280' }}>{String(g.fecha).split(/[T ]/)[0]}</td>
                        <td>{g.descripcion}</td>
                        <td style={{ textAlign: 'right' }}>${fmt(num(g.monto), 0)}</td>
                        <td style={{ padding: '2px 4px' }}>
                          <select value={idSel} onChange={(e) => setMatchOverride((p) => ({ ...p, [g.id_gasto]: e.target.value }))}
                            style={{ width: '100%', fontSize: '12px', color: idSel ? '#111827' : '#dc2626' }}>
                            <option value="">— sin coincidencia —</option>
                            {artActivos.map((a) => <option key={a.id_articulo} value={a.id_articulo}>{a.articulo}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '2px 4px' }}>
                          <input type="number" min={0} step={0.001} value={cantidadGasto[g.id_gasto] || ''}
                            onChange={(e) => setCantidadGasto((p) => ({ ...p, [g.id_gasto]: e.target.value }))}
                            style={{ width: '100%', textAlign: 'right', fontSize: '12px' }} placeholder="cant." />
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button onClick={() => confirmarGasto(g, idSel)} disabled={procesandoGasto === g.id_gasto || !idSel || !(Number(cantidadGasto[g.id_gasto]) > 0)}
                            className="btn" style={{ fontSize: '11px', padding: '3px 8px', marginRight: '4px' }}>
                            {procesandoGasto === g.id_gasto ? '…' : 'Confirmar'}
                          </button>
                          <button onClick={() => descartarGasto(g)} disabled={procesandoGasto === g.id_gasto}
                            className="btn secondary" style={{ fontSize: '11px', padding: '3px 8px' }}>
                            Descartar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#92400e' }}>
                Confirmar suma la cantidad indicada a "Compras" del artículo para este mes. Descartar la oculta sin tocar el stock (ej: gastos que no son insumos físicos).
              </p>
            </div>
          )}

          {/* Panel de carga masiva */}
          {mostrarCarga && (
            <div className="card" style={{ marginBottom: '12px', border: '1px solid #93c5fd', background: '#eff6ff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Carga masiva — {MESES[mes - 1]} {anio}</p>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => setCampoCarga('compras')} className={campoCarga === 'compras' ? 'btn' : 'btn secondary'} style={{ fontSize: '11px', padding: '3px 10px' }}>Compras</button>
                  <button onClick={() => setCampoCarga('stock_final')} className={campoCarga === 'stock_final' ? 'btn' : 'btn secondary'} style={{ fontSize: '11px', padding: '3px 10px' }}>Stock final</button>
                </div>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#6b7280' }}>
                Pegá filas de tu remito, conteo o planilla, una por artículo: <code>Nombre del artículo · Cantidad</code> (funciona con tabulaciones, comas o espacios, tal cual se copia de Excel/Sheets). Esto <strong>reemplaza</strong> el valor de {campoCarga === 'compras' ? 'Compras' : 'Stock final'} de ese mes para cada artículo, no lo suma.
              </p>
              {!filasCarga ? (
                <>
                  <textarea rows={6} value={pegado} onChange={(e) => setPegado(e.target.value)}
                    placeholder={'Cubos Oasis\t50\nGreen Up\t20\nBandejas rúcula\t300'}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '8px', resize: 'vertical' }} />
                  <div style={{ marginTop: '8px' }}>
                    <button onClick={analizarPegado} className="btn" style={{ fontSize: '12px' }} disabled={!pegado.trim()}>Analizar</button>
                  </div>
                </>
              ) : (
                <>
                  <table style={{ fontSize: '12px', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Línea pegada</th>
                        <th style={{ textAlign: 'left', width: '220px' }}>Artículo</th>
                        <th style={{ textAlign: 'right', width: '100px' }}>{campoCarga === 'compras' ? 'Compras' : 'Stock final'}</th>
                        <th style={{ width: '30px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filasCarga.map((f, i) => (
                        <tr key={i} style={{ background: f.id_articulo ? 'transparent' : '#fef2f2' }}>
                          <td style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: '11px' }}>{f.linea}</td>
                          <td style={{ padding: '2px 4px' }}>
                            <select value={f.id_articulo} onChange={(e) => actualizarFilaCarga(i, { id_articulo: e.target.value })}
                              style={{ width: '100%', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 4px', color: f.id_articulo ? '#111827' : '#dc2626' }}>
                              <option value="">— sin coincidencia —</option>
                              {artActivos.map((a) => <option key={a.id_articulo} value={a.id_articulo}>{a.articulo}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '2px 4px' }}>
                            <input type="number" value={f.cantidad} onChange={(e) => actualizarFilaCarga(i, { cantidad: Number(e.target.value) || 0 })}
                              style={{ width: '100%', textAlign: 'right', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 6px' }}
                              min={0} step={0.001} />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button onClick={() => quitarFilaCarga(i)} title="Quitar" style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '14px' }}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filasCarga.some((f) => !f.id_articulo) && (
                    <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#dc2626' }}>⚠ Las filas en rojo no encontraron artículo — elegilo del desplegable o quitá la fila.</p>
                  )}
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button onClick={confirmarCargaMasiva} className="btn" style={{ fontSize: '12px' }}
                      disabled={guardandoMasivo || !filasCarga.some((f) => f.id_articulo)}>
                      {guardandoMasivo ? 'Guardando…' : `Confirmar carga (${filasCarga.filter((f) => f.id_articulo).length})`}
                    </button>
                    <button onClick={() => { setFilasCarga(null); }} className="btn secondary" style={{ fontSize: '12px' }} disabled={guardandoMasivo}>
                      ← Volver a pegar
                    </button>
                  </div>
                </>
              )}
              {resultadoMasivo && <p style={{ margin: '10px 0 0', fontSize: '12px', fontWeight: 600, color: resultadoMasivo.startsWith('Error') ? '#dc2626' : '#059669' }}>{resultadoMasivo}</p>}
            </div>
          )}

          {categorias.map((cat) => {
            const artscat = artActivos.filter((a) => a.categoria === cat);
            return (
              <div key={cat} className="card" style={{ marginBottom: '12px' }}>
                <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{cat}</p>
                <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: '12px', minWidth: '940px' }}>
                  <thead>
                    <tr>
                      <th>Artículo</th>
                      <th style={{ textAlign: 'center', width: '50px' }}>U.</th>
                      <th style={{ textAlign: 'right', width: '100px' }}>Stock inicial</th>
                      <th style={{ textAlign: 'right', width: '100px' }}>Compras</th>
                      <th style={{ textAlign: 'right', width: '90px' }}>Precio compra</th>
                      <th style={{ textAlign: 'right', width: '100px' }}>Stock final</th>
                      <th style={{ textAlign: 'right', width: '80px', color: '#059669', fontWeight: 700 }}>Uso real</th>
                      <th style={{ textAlign: 'right', width: '80px', color: '#6b7280', fontWeight: 700 }}>Uso teórico</th>
                      <th style={{ textAlign: 'right', width: '100px', fontWeight: 700 }}>Dif. real vs teórico</th>
                      <th style={{ textAlign: 'right', width: '100px', fontWeight: 700 }}>Stock final valorizado</th>
                      <th style={{ width: '50px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {artscat.map((art) => {
                      const r = resumenArticulos.find((x) => x.art.id_articulo === art.id_articulo)!;
                      const vals = getEdit(art.id_articulo);
                      const guardado = getStock(art.id_articulo);
                      const modificado = editValues[art.id_articulo] !== undefined;
                      const diffColor = r.diff === null ? '#9ca3af' : r.diff > 0 ? '#dc2626' : '#059669';
                      return (
                        <tr key={art.id_articulo} style={{ background: modificado ? '#fefce8' : 'transparent' }}>
                          <td style={{ fontWeight: 500 }}>{art.articulo}</td>
                          <td style={{ textAlign: 'center', color: '#9ca3af', fontSize: '11px' }}>{art.unidad_medida}</td>
                          <td style={{ padding: '2px 4px' }}>
                            <input type="number" value={vals.ini} onChange={(e) => setField(art.id_articulo, 'ini', e.target.value)}
                              style={{ width: '100%', textAlign: 'right', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 6px' }}
                              min={0} step={0.001} />
                          </td>
                          <td style={{ padding: '2px 4px' }}>
                            <input type="number" value={vals.comp} onChange={(e) => setField(art.id_articulo, 'comp', e.target.value)}
                              style={{ width: '100%', textAlign: 'right', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 6px' }}
                              min={0} step={0.001} />
                          </td>
                          <td style={{ padding: '2px 4px' }}>
                            <input type="number" value={vals.precio} onChange={(e) => setField(art.id_articulo, 'precio', e.target.value)}
                              style={{ width: '100%', textAlign: 'right', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 6px' }}
                              min={0} step={0.01} placeholder={r.precio !== null ? fmt(r.precio, 2) : '—'} />
                          </td>
                          <td style={{ padding: '2px 4px' }}>
                            <input type="number" value={vals.fin} onChange={(e) => setField(art.id_articulo, 'fin', e.target.value)}
                              style={{ width: '100%', textAlign: 'right', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 6px' }}
                              min={0} step={0.001} />
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: r.usoReal > 0 ? '#059669' : r.usoReal < 0 ? '#dc2626' : '#9ca3af', fontSize: '13px' }}>
                            {(r.ini || r.comp || r.fin) ? fmt(r.usoReal) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', color: '#6b7280', fontSize: '13px' }}>
                            {r.usoTeorico !== null ? fmt(r.usoTeorico) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: diffColor, fontSize: '12px' }}>
                            {r.diff !== null && (r.ini || r.comp || r.fin)
                              ? `${r.diff > 0 ? '+' : ''}${fmt(r.diff)}${r.pct !== null ? ` (${r.pct > 0 ? '+' : ''}${fmt(r.pct, 0)}%)` : ''}`
                              : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: '12px', color: r.valorizado !== null ? '#111827' : '#d1d5db' }}>
                            {r.valorizado !== null ? `$${fmt(r.valorizado, 0)}` : '—'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {modificado && (
                              <button onClick={() => guardar(art)} disabled={saving === art.id_articulo}
                                style={{ background: '#059669', color: 'white', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                                {saving === art.id_articulo ? '…' : '✓'}
                              </button>
                            )}
                            {!modificado && guardado && (
                              <span style={{ fontSize: '10px', color: '#9ca3af' }}>✓</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            );
          })}

          {/* Usos del sistema — referencia de los drivers de producción/venta del mes, colapsado */}
          <div className="card" style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setMostrarUsos((v) => !v)}>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Usos del sistema (referencia) — {MESES[mes - 1]} {anio}
              </p>
              <span style={{ fontSize: '11px', color: '#9ca3af' }}>{mostrarUsos ? '▲' : '▼'}</span>
            </div>
            {mostrarUsos && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px', marginTop: '10px' }}>
                {DRIVERS.map((d) => (
                  <div key={d.key} style={{ background: '#f9fafb', borderRadius: '6px', padding: '10px 12px' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{d.label}</p>
                    <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>{fmt((drivers as any)[d.key] || 0)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== VISTA: INFORME COMPARATIVO ===== */}
      {vista === 'informe' && (
        <div className="card">
          <p className="card-title">Uso mensual comparativo — últimos 6 meses</p>
          <p className="card-sub">Uso = Stock inicial + Compras − Stock final</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '12px', minWidth: '700px' }}>
              <thead>
                <tr>
                  <th>Artículo</th>
                  <th style={{ textAlign: 'center', width: '50px' }}>U.</th>
                  {mesesInforme.map((m) => (
                    <th key={m.label} style={{ textAlign: 'right', width: '90px', whiteSpace: 'nowrap' }}>{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categorias.map((cat) => {
                  const artscat = artActivos.filter((a) => a.categoria === cat);
                  const hayDatos = artscat.some((a) =>
                    mesesInforme.some((m) => getUso(a.id_articulo, m.anio, m.mes) !== null)
                  );
                  if (!hayDatos) return null;
                  return (
                    <>
                      <tr key={'cat-' + cat} style={{ background: '#f8fafc' }}>
                        <td colSpan={2 + mesesInforme.length} style={{ fontWeight: 700, fontSize: '11px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.3px', padding: '6px 8px' }}>{cat}</td>
                      </tr>
                      {artscat.map((art) => {
                        const usos = mesesInforme.map((m) => getUso(art.id_articulo, m.anio, m.mes));
                        if (usos.every((u) => u === null)) return null;
                        const maxUso = Math.max(...usos.filter((u): u is number => u !== null));
                        return (
                          <tr key={art.id_articulo}>
                            <td style={{ fontWeight: 500 }}>{art.articulo}</td>
                            <td style={{ textAlign: 'center', color: '#9ca3af', fontSize: '11px' }}>{art.unidad_medida}</td>
                            {usos.map((u, i) => (
                              <td key={i} style={{
                                textAlign: 'right',
                                fontWeight: u === maxUso && u > 0 ? 700 : 400,
                                color: u === null ? '#e5e7eb' : u > 0 ? '#1f2937' : '#dc2626',
                                background: u !== null && u > 0 && maxUso > 0
                                  ? `rgba(5, 150, 105, ${0.05 + (u / maxUso) * 0.2})`
                                  : 'transparent',
                              }}>
                                {u === null ? '—' : u.toLocaleString('es-AR', { maximumFractionDigits: 3 })}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
