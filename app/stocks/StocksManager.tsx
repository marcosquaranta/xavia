'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Articulo, StockMes, Lote } from '@/lib/types';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const HOY = new Date();

interface Props { articulos: Articulo[]; stocks: StockMes[]; lotes: Lote[]; usuario: string; }

function num(v: any) { const n = Number(v); return isNaN(n) ? 0 : n; }

export default function StocksManager({ articulos, stocks, lotes, usuario }: Props) {
  const router = useRouter();
  const [anio, setAnio] = useState(HOY.getFullYear());
  const [mes, setMes] = useState(HOY.getMonth() + 1);
  const [vista, setVista] = useState<'carga' | 'informe'>('carga');
  const [saving, setSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, { ini: string; comp: string; fin: string; notas: string }>>({});

  const categorias = useMemo(() => Array.from(new Set(articulos.map((a) => a.categoria))).sort(), [articulos]);

  // Usos del sistema para el mes seleccionado
  const usosDelMes = useMemo(() => {
    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);
    function parseF(s: any) { if (!s) return null; try { return new Date(String(s).split(/[\sT]/)[0]); } catch { return null; } }
    const sembrados = lotes.filter((l) => { const f = parseF(l.fecha_siembra); return f && f >= inicioMes && f <= finMes; });
    const cosechados = lotes.filter((l) => { if (l.estado !== 'cosechado') return false; const f = parseF(l.fecha_cosecha); return f && f >= inicioMes && f <= finMes; });
    const esRucula = (l: any) => String(l.variedad||'').toLowerCase().includes('rucula') || String(l.variedad||'').toLowerCase().includes('rúcula');
    const sembLechuga = sembrados.filter((l) => !esRucula(l));
    const sembRucula  = sembrados.filter((l) => esRucula(l));
    const CUBOS_POR_PLANCHA = 345;
    const GR_SEMILLA_RUCULA = 13;   // gramos por plancha
    const GR_SEMILLA_LECHUGA = 16;  // gramos por plancha
    const planchasLechuga = Math.round(sembLechuga.reduce((a, l) => a + (Number(l.plantines_iniciales) || 0), 0) / CUBOS_POR_PLANCHA);
    const planchasRucula  = Math.round(sembRucula.reduce((a, l) => a + (Number(l.plantines_iniciales) || 0), 0) / CUBOS_POR_PLANCHA);
    const semillaLechugaGr = planchasLechuga * GR_SEMILLA_LECHUGA;
    const semillaRuculaGr  = planchasRucula  * GR_SEMILLA_RUCULA;
    const paqRucula   = cosechados.filter((l) => esRucula(l)).reduce((a, l) => a + (Number(l.unidades_cosechadas)||0), 0);
    const plantasLech = cosechados.filter((l) => !esRucula(l)).reduce((a, l) => a + (Number(l.unidades_cosechadas)||0), 0);
    return { planchasLechuga, planchasRucula, semillaLechugaGr, semillaRuculaGr, paqRucula, plantasLech, sembrados: sembrados.length, cosechados: cosechados.length };
  }, [lotes, anio, mes]);

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
    if (s) return { ini: String(num(s.stock_inicial)), comp: String(num(s.compras)), fin: String(num(s.stock_final)), notas: s.notas || '' };
    // Sin registro: pre-completar stock inicial = stock final del mes anterior
    let mesPrev = mes - 1, anioPrev = anio;
    if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
    const sPrev = stocks.find((st) => st.id_articulo === id && String(st.anio) === String(anioPrev) && String(st.mes) === String(mesPrev));
    const iniAuto = sPrev && num(sPrev.stock_final) > 0 ? String(num(sPrev.stock_final)) : '';
    return { ini: iniAuto, comp: '', fin: '', notas: '' };
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
          stock_final: vals.fin, notas: vals.notas,
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
      </div>

      {/* ===== VISTA: CARGA MENSUAL ===== */}
      {vista === 'carga' && (
        <div>
          {/* Usos del sistema para el mes seleccionado */}
          <div className="card" style={{ marginBottom: '12px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Usos del sistema — {MESES[mes - 1]} {anio}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
              {/* Leyenda de fórmulas */}
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#6b7280', background: '#f8fafc', padding: '6px 10px', borderRadius: '6px', borderLeft: '3px solid #e2e8f0' }}>
                1 plancha = 345 cubos · Semilla lechuga: 16 gr/plancha · Semilla rúcula: 13 gr/plancha
              </p>
              {[
                ['Planchas lechuga', usosDelMes.planchasLechuga, `${usosDelMes.planchasLechuga * 345} cubos Oasis`],
                ['Planchas rúcula', usosDelMes.planchasRucula, `${usosDelMes.planchasRucula * 345} cubos Green Up`],
                ['Semilla lechuga', `${usosDelMes.semillaLechugaGr} gr`, `${usosDelMes.planchasLechuga} pl × 16 gr`],
                ['Semilla rúcula', `${usosDelMes.semillaRuculaGr} gr`, `${usosDelMes.planchasRucula} pl × 13 gr`],
                ['Paquetes rúcula', usosDelMes.paqRucula, 'bolsas rúcula cosech.'],
                ['Plantas lechuga', usosDelMes.plantasLech.toLocaleString('es-AR'), 'bolsas lechuga cosech.'],
                ['Lotes sembrados', usosDelMes.sembrados, 'nuevos este mes'],
                ['Lotes cosechados', usosDelMes.cosechados, 'cerrados este mes'],
              ].map(([label, value, sub]: any) => (
                <div key={label} style={{ background: '#f9fafb', borderRadius: '6px', padding: '10px 12px' }}>
                  <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</p>
                  <p style={{ margin: '0 0 2px', fontSize: '18px', fontWeight: 700, color: '#111827' }}>{value}</p>
                  <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af' }}>{sub}</p>
                </div>
              ))}
            </div>
          </div>

          {categorias.map((cat) => {
            const artscat = artActivos.filter((a) => a.categoria === cat);
            return (
              <div key={cat} className="card" style={{ marginBottom: '12px' }}>
                <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{cat}</p>
                <table style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th>Artículo</th>
                      <th style={{ textAlign: 'center', width: '60px' }}>U.</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>Stock inicial</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>Compras</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>Stock final</th>
                      <th style={{ textAlign: 'right', width: '90px', color: '#059669', fontWeight: 700 }}>Uso</th>
                      <th style={{ width: '60px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {artscat.map((art) => {
                      const vals = getEdit(art.id_articulo);
                      const ini = num(vals.ini); const comp = num(vals.comp); const fin = num(vals.fin);
                      const uso = ini + comp - fin;
                      const guardado = getStock(art.id_articulo);
                      const modificado = editValues[art.id_articulo] !== undefined;
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
                            <input type="number" value={vals.fin} onChange={(e) => setField(art.id_articulo, 'fin', e.target.value)}
                              style={{ width: '100%', textAlign: 'right', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 6px' }}
                              min={0} step={0.001} />
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: uso > 0 ? '#059669' : uso < 0 ? '#dc2626' : '#9ca3af', fontSize: '13px' }}>
                            {(ini || comp || fin) ? uso.toLocaleString('es-AR', { maximumFractionDigits: 3 }) : '—'}
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
            );
          })}
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
