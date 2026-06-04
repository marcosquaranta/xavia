import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorNave, tubosPorMesada } from '@/lib/ocupacion';
import { cosechadoEsteMes, plantasPorCultivo, variacionVsMesAnterior, distribucionPorSemana, resumenCosechaPorCultivo, diasPromedioPorVariedad, ciclosPorSemana } from '@/lib/estadisticas';
import { aplicarFiltros3, contarPorFiltro, type FiltroCultivo, type FiltroFase, type FiltroNave } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import FiltrosLotes from '@/components/FiltrosLotes';
import LoteCard from '@/components/LoteCard';
import GraficoCiclos from '@/components/GraficoCiclos';
import GraficoCiclosSemanas from '@/components/GraficoCiclosSemanas';
import BuscadorLote from '@/components/BuscadorLote';

// v72
export const dynamic = 'force-dynamic';

export default async function PanelPage({ searchParams }: {
  searchParams: { cultivo?: string; fase?: string; nave?: string; mesada?: string; tiempo?: string; q?: string }
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const cultivo = (searchParams.cultivo || 'todos') as FiltroCultivo;
  const fase    = (searchParams.fase    || 'todas') as FiltroFase;
  const nave    = (searchParams.nave    || 'todas') as FiltroNave;
  const mesada  = searchParams.mesada  || 'todas';
  const tiempo  = (searchParams.tiempo || 'todos') as any;
  const query   = (searchParams.q || '').trim().toLowerCase();

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [], variedades: Variedad[] = [];
  try {
    [lotes, movimientos, ubicaciones, variedades] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'), readSheet<Variedad>('Variedades'),
    ]);
  } catch {}

  let cosechadoMes = 0, cosechadoMesPasado = 0, diaCorte = new Date().getDate();
  let navesOcup: any[] = [], tubosMesadas: any[] = [];
  let resumen = { lechuga: { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 }, rucula: { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 }, albahaca: { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 } };
  let ciclosLechuga = { barras: [] as any[], semanasCosecha: 5 };
  let ciclosRucula  = { barras: [] as any[], semanasCosecha: 3 };
  let resumenCosecha: any[] = [];
  let tiemposCiclo: any[] = [], tiemposCicloAnt: any[] = [], ciclosSemanas: any[] = [];

  try {
    const mes = cosechadoEsteMes(lotes);
    cosechadoMes = mes.actual; cosechadoMesPasado = mes.pasado; diaCorte = mes.diaCorte;
    navesOcup   = ocupacionPorNave(ubicaciones, lotes);
    tubosMesadas = tubosPorMesada(ubicaciones, lotes);
    resumen     = plantasPorCultivo(lotes);
    ciclosLechuga = distribucionPorSemana(lotes, variedades, 'lechuga');
    ciclosRucula  = distribucionPorSemana(lotes, variedades, 'rucula');
    resumenCosecha = resumenCosechaPorCultivo(lotes, variedades);
    tiemposCiclo   = diasPromedioPorVariedad(lotes, movimientos, 60);
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
    const hace90 = new Date(); hace90.setDate(hace90.getDate() - 90);
    const lotesAnt = lotes.filter(l => { if (l.estado !== 'cosechado') return false; const f = l.fecha_cosecha ? new Date(String(l.fecha_cosecha).split(/[\sT]/)[0]) : null; return f && f < hace30 && f >= hace90; });
    tiemposCicloAnt = diasPromedioPorVariedad(lotesAnt, movimientos, 90);
    ciclosSemanas   = ciclosPorSemana(lotes, movimientos);
  } catch {}

  const ocGlobal = navesOcup.length > 0
    ? Math.round(navesOcup.reduce((a: number, n: any) => a + n.tubos_ocupados, 0) /
      Math.max(1, navesOcup.reduce((a: number, n: any) => a + n.tubos_totales, 0)) * 100)
    : 0;
  const difPct = cosechadoMesPasado > 0
    ? Math.round(((cosechadoMes - cosechadoMesPasado) / cosechadoMesPasado) * 100) : 0;

  const conteos = contarPorFiltro(lotes, nave);
  const lotesFiltrados = query
    ? lotes.filter(l => String(l.id_lote || '').toLowerCase().includes(query))
    : aplicarFiltros3(lotes, cultivo, fase, nave, mesada, tiempo);

  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  // KPIs de ciclo F2 de la semana más reciente
  const ultSem = ciclosSemanas.filter((s: any) => s.lechugaF2 > 0 || s.rucula > 0).slice(-1)[0];
  const antSem = ciclosSemanas.filter((s: any) => s.lechugaF2 > 0 || s.rucula > 0).slice(-2, -1)[0];
  function varPctSem(a: number, b: number) { if (!b || !a) return null; return Math.round(((a - b) / b) * 100); }

  const rL = resumenCosecha.find((r: any) => r.cultivo === 'lechuga');
  const rR = resumenCosecha.find((r: any) => r.cultivo === 'rucula');

  return (
    <>
      <Header user={user} current="panel" />
      <div className="container">
        <h1 className="page-title">Panel de control</h1>
        <p className="page-subtitle">{hoy.charAt(0).toUpperCase() + hoy.slice(1)} · Bienvenido, {user.nombre}</p>

        {/* ══ FILA 1: PROYECCIÓN DEL MES — lo más importante ══ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px', marginBottom: '14px' }}>

          {/* Lechuga — proyección */}
          {rL && (
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderTop: '4px solid #4d7c0f', borderRadius: '10px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ background: '#4d7c0f', color: 'white', padding: '2px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 800, letterSpacing: '0.5px' }}>LECHUGA</span>
                <span style={{ fontSize: '11px', color: '#6b7280' }}>Proyección junio</span>
              </div>
              {/* Número grande: total mes estimado */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '36px', fontWeight: 800, color: '#14532d', lineHeight: 1 }}>
                  {(rL.cosechadoMes + rL.proyectadoMesTotal).toLocaleString('es-AR')}
                </span>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>plantas est. mes</span>
                {rL.variacionPct !== null && (
                  <span style={{ fontSize: '16px', fontWeight: 800, color: rL.variacionPct >= 0 ? '#059669' : '#dc2626' }}>
                    {rL.variacionPct >= 0 ? '↑' : '↓'}{Math.abs(rL.variacionPct)}%
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '12px' }}>
                vs {rL.cosechadoMesAntProporcional.toLocaleString('es-AR')} plantas mayo completo
              </div>
              {/* Desglose */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                {[
                  { label: 'Cosechado', val: rL.cosechadoMes, color: '#4d7c0f', bg: '#f7fee7' },
                  { label: 'Próx. 7d', val: rL.proyectadoEstaSemana, color: '#854d0e', bg: '#fefce8' },
                  { label: 'Resto mes', val: rL.proyectadoRestoMes, color: '#059669', bg: '#f0fdf4' },
                ].map(({ label, val, color, bg }) => (
                  <div key={label} style={{ background: val > 0 ? bg : '#f9fafb', borderRadius: '6px', padding: '7px 6px', textAlign: 'center' }}>
                    <p style={{ margin: '0 0 1px', fontSize: '9px', color: val > 0 ? color : '#9ca3af', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.3px' }}>{label}</p>
                    <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: val > 0 ? '#111827' : '#d1d5db' }}>{val > 0 ? val.toLocaleString('es-AR') : '—'}</p>
                  </div>
                ))}
              </div>
              {/* Stock actual */}
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f3f4f6', display: 'flex', gap: '12px', fontSize: '11px', color: '#6b7280' }}>
                <span>Plantinera: <strong style={{ color: '#374151' }}>{resumen.lechuga.plantinera.toLocaleString('es-AR')}</strong></span>
                <span>F1: <strong style={{ color: '#374151' }}>{resumen.lechuga.fase_1.toLocaleString('es-AR')}</strong></span>
                <span>F2: <strong style={{ color: '#4d7c0f' }}>{resumen.lechuga.fase_2.toLocaleString('es-AR')}</strong></span>
              </div>
            </div>
          )}

          {/* Rúcula — proyección */}
          {rR && (
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderTop: '4px solid #166534', borderRadius: '10px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ background: '#166534', color: 'white', padding: '2px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 800, letterSpacing: '0.5px' }}>RÚCULA</span>
                <span style={{ fontSize: '11px', color: '#6b7280' }}>Proyección junio</span>
              </div>
              {/* Número grande en paquetes */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
                <span style={{ fontSize: '36px', fontWeight: 800, color: '#14532d', lineHeight: 1 }}>
                  {(rR.cosechadoMes + rR.proyectadoMesTotal).toLocaleString('es-AR')}
                </span>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>paq. est. mes</span>
                {rR.variacionPct !== null && (
                  <span style={{ fontSize: '16px', fontWeight: 800, color: rR.variacionPct >= 0 ? '#059669' : '#dc2626' }}>
                    {rR.variacionPct >= 0 ? '↑' : '↓'}{Math.abs(rR.variacionPct)}%
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '12px' }}>
                ~{((rR.cosechadoMes + rR.proyectadoMesTotal) * rR.plantasPorPaquete).toLocaleString('es-AR')} plantas · vs {rR.cosechadoMesAntProporcional} paq. mayo
              </div>
              {/* Desglose */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                {[
                  { label: 'Cosechado', val: rR.cosechadoMes, color: '#166534', bg: '#dcfce7' },
                  { label: 'Próx. 7d', val: rR.proyectadoEstaSemana, color: '#854d0e', bg: '#fefce8' },
                  { label: 'Resto mes', val: rR.proyectadoRestoMes, color: '#059669', bg: '#f0fdf4' },
                ].map(({ label, val, color, bg }) => (
                  <div key={label} style={{ background: val > 0 ? bg : '#f9fafb', borderRadius: '6px', padding: '7px 6px', textAlign: 'center' }}>
                    <p style={{ margin: '0 0 1px', fontSize: '9px', color: val > 0 ? color : '#9ca3af', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.3px' }}>{label}</p>
                    <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: val > 0 ? '#111827' : '#d1d5db' }}>{val > 0 ? val.toLocaleString('es-AR') : '—'}</p>
                    {label === 'Próx. 7d' && val > 0 && (
                      <p style={{ margin: '1px 0 0', fontSize: '9px', color: '#9ca3af' }}>~{(val * rR.plantasPorPaquete).toLocaleString('es-AR')} pl</p>
                    )}
                  </div>
                ))}
              </div>
              {/* Stock actual */}
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f3f4f6', display: 'flex', gap: '12px', fontSize: '11px', color: '#6b7280' }}>
                <span>Plantinera: <strong style={{ color: '#374151' }}>{resumen.rucula.plantinera.toLocaleString('es-AR')}</strong> pl</span>
                <span>F2: <strong style={{ color: '#166534' }}>{Math.round(resumen.rucula.fase_2 / 3).toLocaleString('es-AR')}</strong> paq. ({resumen.rucula.fase_2.toLocaleString('es-AR')} pl)</span>
              </div>
            </div>
          )}

          {/* Columna derecha: Ocupación + Cosechado */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Ocupación global</p>
              <p style={{ margin: '0 0 6px', fontSize: '28px', fontWeight: 800, color: '#111827' }}>{ocGlobal}%</p>
              {navesOcup.map((n: any) => (
                <div key={n.nave} style={{ fontSize: '12px', color: '#6b7280', lineHeight: 2 }}>
                  Nave {n.nave}: <strong style={{ color: '#1f2937' }}>{n.ocupacion_pct}%</strong>
                  {n.tubos_libres > 0 && <span style={{ color: '#059669' }}> · {n.tubos_libres} libres</span>}
                </div>
              ))}
            </div>
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
              <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Cosechado este mes</p>
              <p style={{ margin: '0 0 6px', fontSize: '28px', fontWeight: 800 }}>{cosechadoMes.toLocaleString('es-AR')}</p>
              {cosechadoMesPasado > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: difPct >= 0 ? '#059669' : '#dc2626' }}>
                    {difPct >= 0 ? '↑' : '↓'} {Math.abs(difPct)}%
                  </span>
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>vs mayo ({cosechadoMesPasado.toLocaleString('es-AR')} u)</span>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>Sin cosechas mayo</p>
              )}
            </div>
          </div>
        </div>

        {/* ══ FILA 2: CICLOS — gráfico semanal + KPIs F2 + últimas cosechas ══ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
          {/* Ciclos semanas + KPIs F2 */}
          <div className="card" style={{ margin: 0 }}>
            <p className="card-title">Ciclos en mesadas — 8 semanas</p>
            <p className="card-sub">Días promedio F2 por semana de cosecha · sin plantinera</p>
            <GraficoCiclosSemanas datos={ciclosSemanas} />
            {ultSem && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f3f4f6' }}>
                {ultSem.lechugaF2 > 0 && (
                  <div style={{ textAlign: 'center', padding: '10px', background: '#f7fee7', borderRadius: '8px' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#4d7c0f', textTransform: 'uppercase', fontWeight: 700 }}>Lechuga F2 actual</p>
                    <p style={{ margin: '0 0 2px', fontSize: '28px', fontWeight: 800, color: '#14532d' }}>{ultSem.lechugaF2}d</p>
                    {varPctSem(ultSem.lechugaF2, antSem?.lechugaF2) !== null && (
                      <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: varPctSem(ultSem.lechugaF2, antSem?.lechugaF2)! <= 0 ? '#059669' : '#dc2626' }}>
                        {varPctSem(ultSem.lechugaF2, antSem?.lechugaF2)! <= 0 ? '↓' : '↑'} {Math.abs(varPctSem(ultSem.lechugaF2, antSem?.lechugaF2)!)}% vs sem ant.
                      </p>
                    )}
                  </div>
                )}
                {ultSem.rucula > 0 && (
                  <div style={{ textAlign: 'center', padding: '10px', background: '#f0fdf4', borderRadius: '8px' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#166534', textTransform: 'uppercase', fontWeight: 700 }}>Rúcula F2 actual</p>
                    <p style={{ margin: '0 0 2px', fontSize: '28px', fontWeight: 800, color: '#14532d' }}>{ultSem.rucula}d</p>
                    {varPctSem(ultSem.rucula, antSem?.rucula) !== null && (
                      <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: varPctSem(ultSem.rucula, antSem?.rucula)! <= 0 ? '#059669' : '#dc2626' }}>
                        {varPctSem(ultSem.rucula, antSem?.rucula)! <= 0 ? '↓' : '↑'} {Math.abs(varPctSem(ultSem.rucula, antSem?.rucula)!)}% vs sem ant.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Últimas cosechas */}
          <div className="card" style={{ margin: 0 }}>
            <p className="card-title">Últimas cosechas</p>
            <p className="card-sub">Días por fase · sin plantinera</p>
            <table style={{ fontSize: '11px' }}>
              <thead>
                <tr>
                  <th>Lote</th><th>Var.</th>
                  <th style={{ textAlign:'right' }}>Plant.</th>
                  <th style={{ textAlign:'right' }}>F1</th>
                  <th style={{ textAlign:'right' }}>F2</th>
                  <th style={{ textAlign:'right' }}>Total</th>
                  <th style={{ textAlign:'right' }}>Cosech.</th>
                </tr>
              </thead>
              <tbody>
                {lotes.filter((l: any) => l.estado === 'cosechado' && l.dias_total)
                  .sort((a: any, b: any) => String(b.fecha_cosecha||'').localeCompare(String(a.fecha_cosecha||'')))
                  .slice(0, 9)
                  .map((l: any) => {
                    const esR = String(l.variedad||'').toLowerCase().includes('rucula');
                    const u = Number(l.unidades_cosechadas) || 0;
                    return (
                      <tr key={l.id_lote}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{l.id_lote}</td>
                        <td style={{ color: esR ? '#166534' : '#4d7c0f' }}>{String(l.variedad||'').split(' ')[0]}</td>
                        <td style={{ textAlign:'right', color: '#9ca3af' }}>{l.dias_plantinera ? l.dias_plantinera+'d' : '—'}</td>
                        <td style={{ textAlign:'right', color: '#9ca3af' }}>{l.dias_f1 ? l.dias_f1+'d' : '—'}</td>
                        <td style={{ textAlign:'right', color: '#9ca3af' }}>{l.dias_f2 ? l.dias_f2+'d' : '—'}</td>
                        <td style={{ textAlign:'right', fontWeight: 600 }}>{l.dias_total}d</td>
                        <td style={{ textAlign:'right', color: esR ? '#166534' : '#4d7c0f', fontWeight: 500 }}>
                          {u > 0 ? `${u} ${esR ? 'paq' : 'pl'}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ══ FILA 3: DISTRIBUCIÓN EN MESADAS ══ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Distribución en mesadas</p>
            <p style={{ margin: '0 0 12px', fontSize: '10px', color: '#9ca3af' }}>Semana de ciclo desde siembra · Solo F1 y F2</p>
            <GraficoCiclos titulo="Lechuga" color="#4d7c0f" colorF1="#86efac" colorF2="#16a34a" barras={ciclosLechuga.barras} semanasCosecha={ciclosLechuga.semanasCosecha} semanaActual={0} />
          </div>
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Distribución en mesadas</p>
            <p style={{ margin: '0 0 12px', fontSize: '10px', color: '#9ca3af' }}>Semana de ciclo desde siembra · Solo F2</p>
            <GraficoCiclos titulo="Rúcula" color="#166534" colorF1="#6ee7b7" colorF2="#047857" barras={ciclosRucula.barras} semanasCosecha={ciclosRucula.semanasCosecha} semanaActual={0} sinF1 />
          </div>
        </div>

        {/* ══ FILA 4: OCUPACIÓN POR MESADA (compacta) ══ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
          {tubosMesadas.map((nave: any) => (
            <div key={nave.nave} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ background: nave.nave === 1 ? '#881337' : '#7c3aed', color: 'white', padding: '2px 10px', borderRadius: '5px', fontSize: '12px', fontWeight: 700 }}>NAVE {nave.nave}</span>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>{nave.tubos_ocupados}/{nave.tubos_totales} · <strong>{nave.ocupacion_pct}%</strong></span>
              </div>
              <div style={{ height: '4px', background: '#f3f4f6', borderRadius: '2px', overflow: 'hidden', marginBottom: '10px' }}>
                <div style={{ width: Math.min(100, nave.ocupacion_pct) + '%', height: '100%', background: nave.nave === 1 ? '#881337' : '#7c3aed' }} />
              </div>
              <table style={{ fontSize: '11px' }}>
                <thead><tr>
                  <th>Mesada</th>
                  <th style={{ textAlign:'center', width: '30px' }}>F</th>
                  <th style={{ textAlign:'right' }}>Total</th>
                  <th style={{ textAlign:'right' }}>Ocup.</th>
                  <th style={{ textAlign:'right' }}>Libres</th>
                  <th style={{ textAlign:'right' }}>%</th>
                </tr></thead>
                <tbody>
                  {nave.mesadas.map((m: any) => (
                    <tr key={m.id_ubicacion}>
                      <td style={{ fontWeight: 500 }}>{m.nombre.replace(/^Nave \d+ - /, '').replace(' (F1)', '').replace(' (F2)', '')}</td>
                      <td style={{ textAlign:'center' }}>
                        <span style={{ background: m.sector_fase === 'fase_1' ? '#dbeafe' : '#dcfce7', color: m.sector_fase === 'fase_1' ? '#1e40af' : '#166534', padding: '1px 5px', borderRadius: '3px', fontSize: '10px', fontWeight: 600 }}>
                          {m.sector_fase === 'fase_1' ? 'F1' : 'F2'}
                        </span>
                      </td>
                      <td style={{ textAlign:'right', color: '#6b7280' }}>{m.tubos_totales}</td>
                      <td style={{ textAlign:'right', fontWeight: 600 }}>{m.tubos_ocupados}</td>
                      <td style={{ textAlign:'right', color: m.tubos_libres > 0 ? '#059669' : '#9ca3af' }}>{m.tubos_libres}</td>
                      <td style={{ textAlign:'right', fontWeight: 600, color: m.ocupacion_pct >= 80 ? '#059669' : m.ocupacion_pct >= 40 ? '#d97706' : '#9ca3af' }}>{m.ocupacion_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* ══ ACCIONES RÁPIDAS ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/cultivos/nuevo" className="btn">+ Nuevo lote</Link>
            <Link href="/ocupacion" className="btn secondary">Ocupación</Link>
            <Link href="/estadisticas" className="btn secondary">Estadísticas</Link>
          </div>
        </div>

        {/* ══ LOTES CON FILTROS ══ */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Cultivos activos {cultivo !== 'todos' || fase !== 'todas' || nave !== 'todas' || query ? '— ' + lotesFiltrados.length + ' de ' + conteos.todos : '(' + conteos.todos + ')'}
          </h2>
        </div>
        <BuscadorLote baseUrl="/panel" />
        {!query && <FiltrosLotes cultivoActivo={cultivo} faseActiva={fase} naveActiva={nave} mesadaActiva={mesada} tiempoActivo={tiempo} conteos={conteos} ubicaciones={ubicaciones} baseUrl="/panel" />}
        {query && <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>{lotesFiltrados.length === 0 ? 'Sin resultados para "' + searchParams.q + '"' : lotesFiltrados.length + ' resultado' + (lotesFiltrados.length > 1 ? 's' : '') + ' para "' + searchParams.q + '"'}</p>}
        {lotesFiltrados.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ margin: 0, color: '#6b7280' }}>No hay lotes con este filtro.</p>
            <Link href="/cultivos/nuevo" className="btn" style={{ marginTop: '14px', display: 'inline-block' }}>+ Crear lote</Link>
          </div>
        ) : lotesFiltrados.map(lote => (
          <LoteCard key={lote.id_lote} lote={lote} movimientos={movimientos} ubicaciones={ubicaciones} variedades={variedades} />
        ))}
      </div>
    </>
  );
}
