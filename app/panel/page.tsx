import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorNave } from '@/lib/ocupacion';
import { cosechadoEsteMes, plantasPorCultivo, variacionVsMesAnterior, distribucionPorSemana, resumenCosechaPorCultivo, diasPromedioPorVariedad, ciclosPorSemana } from '@/lib/estadisticas';
import { aplicarFiltros3,  contarPorFiltro, type FiltroCultivo, type FiltroFase, type FiltroNave } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import FiltrosLotes from '@/components/FiltrosLotes';
import LoteCard from '@/components/LoteCard';
import GraficoCiclos from '@/components/GraficoCiclos';
import GraficoCiclosSemanas from '@/components/GraficoCiclosSemanas';
import BuscadorLote from '@/components/BuscadorLote';

export const dynamic = 'force-dynamic';

export default async function PanelPage({ searchParams }: { searchParams: { cultivo?: string; fase?: string; nave?: string; mesada?: string; tiempo?: string; q?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const cultivo = (searchParams.cultivo || 'todos') as FiltroCultivo;
  const fase = (searchParams.fase || 'todas') as FiltroFase;
  const nave = (searchParams.nave || 'todas') as FiltroNave;
  const mesada = searchParams.mesada || 'todas';
  const tiempo = (searchParams.tiempo || 'todos') as any;
  const query = (searchParams.q || '').trim().toLowerCase();

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [], variedades: Variedad[] = [];
  try {
    [lotes, movimientos, ubicaciones, variedades] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'), readSheet<Variedad>('Variedades'),
    ]);
  } catch {}

  let cosechadoMes = 0, cosechadoMesPasado = 0, diaCorte = new Date().getDate(), navesOcup: any[] = [];
  let resumen = {
    lechuga:  { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 },
    rucula:   { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 },
    albahaca: { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 },
  };
  let varL: number | null = null, varR: number | null = null;
  let ciclosLechuga = { barras: [] as any[], semanasCosecha: 5 };
  let ciclosRucula  = { barras: [] as any[], semanasCosecha: 3 };
  let resumenCosecha: any[] = [];
  let tiemposCiclo: any[] = [];
  let tiemposCicloAnt: any[] = [];
  let ciclosSemanas: any[] = [];

  try {
    const mes = cosechadoEsteMes(lotes);
    cosechadoMes = mes.actual; cosechadoMesPasado = mes.pasado; diaCorte = mes.diaCorte;
    navesOcup = ocupacionPorNave(ubicaciones, lotes);
    resumen = plantasPorCultivo(lotes);
    varL = variacionVsMesAnterior(lotes, 'lechuga');
    varR = variacionVsMesAnterior(lotes, 'rucula');
    ciclosLechuga = distribucionPorSemana(lotes, variedades, 'lechuga');
    ciclosRucula  = distribucionPorSemana(lotes, variedades, 'rucula');
    resumenCosecha = resumenCosechaPorCultivo(lotes, variedades);
    tiemposCiclo = diasPromedioPorVariedad(lotes, movimientos, 60);
    // Mes anterior: cosechados entre hace 30-90 días
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
    const hace90 = new Date(); hace90.setDate(hace90.getDate() - 90);
    const lotesAnteriores = lotes.map((l) => {
      if (l.estado !== 'cosechado') return null;
      const f = l.fecha_cosecha ? new Date(String(l.fecha_cosecha)) : null;
      if (f && f < hace30 && f >= hace90) return l;
      return null;
    }).filter(Boolean) as typeof lotes;
    tiemposCicloAnt = diasPromedioPorVariedad(lotesAnteriores, movimientos, 90);
    ciclosSemanas = ciclosPorSemana(lotes, movimientos);
  } catch {}

  const difPct = cosechadoMesPasado > 0
    ? Math.round(((cosechadoMes - cosechadoMesPasado) / cosechadoMesPasado) * 100) : 0;
  const ocGlobal = navesOcup.length > 0
    ? navesOcup.reduce((a: number, n: any) => a + n.tubos_ocupados, 0) /
      Math.max(1, navesOcup.reduce((a: number, n: any) => a + n.tubos_totales, 0))
    : 0;

  const conteos = contarPorFiltro(lotes, nave);
  const lotesFiltrados = query
    ? lotes.filter((l) => String(l.id_lote || '').toLowerCase().includes(query))
    : aplicarFiltros3(lotes, cultivo, fase, nave, mesada, tiempo);
  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <Header user={user} current="panel" />
      <div className="container">
        <h1 className="page-title">Panel de control</h1>
        <p className="page-subtitle">{hoy.charAt(0).toUpperCase() + hoy.slice(1)} · Bienvenido, {user.nombre}</p>

        {/* Cards Lechuga + Rúcula + Stats globales */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <CultivoCard titulo="Lechuga" color="#4d7c0f" colorBg="#f7fee7" datos={resumen.lechuga} variacion={varL} tieneFase1 />
          <CultivoCard titulo="Rúcula"  color="#166534" colorBg="#dcfce7" datos={resumen.rucula}  variacion={varR} tieneFase1={false} esRucula />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', flex: 1 }}>
              <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Ocupación global</p>
              <p style={{ margin: '0 0 4px', fontSize: '26px', fontWeight: 700 }}>{Math.round(ocGlobal * 100)}%</p>
              <div style={{ fontSize: '11px', color: '#6b7280', lineHeight: 1.9 }}>
                {navesOcup.map((n: any) => (
                  <div key={n.nave}>
                    Nave {n.nave}: <strong style={{ color: '#1f2937' }}>{n.ocupacion_pct}%</strong>
                    <span style={{ color: '#9ca3af' }}> · {n.densidad_actual} pl/m²</span>
                    {n.tubos_libres > 0 && <span style={{ color: '#059669' }}> · {n.tubos_libres} tubos libres</span>}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', flex: 1 }}>
              <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Cosechado este mes</p>
              <p style={{ margin: '0 0 6px', fontSize: '26px', fontWeight: 700 }}>{cosechadoMes.toLocaleString('es-AR')}</p>
              {cosechadoMesPasado > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: difPct >= 0 ? '#059669' : '#dc2626' }}>
                    {difPct >= 0 ? '↑' : '↓'} {Math.abs(difPct)}%
                  </span>
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>vs días 1-{diaCorte} mes ant. ({cosechadoMesPasado.toLocaleString('es-AR')} u)</span>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>Sin cosechas en período comparable</p>
              )}
            </div>
          </div>
        </div>

        {/* Resumen de cosecha por cultivo */}
        {resumenCosecha.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            {resumenCosecha.map((r: any) => (
              <div key={r.cultivo} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ background: r.cultivo === 'lechuga' ? '#4d7c0f' : '#166534', color: 'white', padding: '2px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.5px' }}>
                    {r.label.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>Este mes</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  {/* Cosechado este mes */}
                  <div style={{ textAlign: 'center', padding: '10px 8px', background: '#f9fafb', borderRadius: '6px' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Cosechado mes actual</p>
                    <p style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111827' }}>{r.cosechadoMes.toLocaleString('es-AR')}</p>
                    <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#9ca3af' }}>
                      {r.cultivo === 'rucula' ? `paq. (~${(r.cosechadoMes * r.plantasPorPaquete).toLocaleString('es-AR')} plantas)` : 'plantas'}
                    </p>
                  </div>
                  {/* vs mes anterior */}
                  <div style={{ textAlign: 'center', padding: '10px 8px', background: '#f9fafb', borderRadius: '6px' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Mes ant. (al día {new Date().getDate()})</p>
                    <p style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111827' }}>{r.cosechadoMesAntProporcional.toLocaleString('es-AR')}</p>
                    {r.variacionPct !== null && (
                      <p style={{ margin: '2px 0 0', fontSize: '11px', fontWeight: 600, color: r.variacionPct >= 0 ? '#059669' : '#dc2626' }}>
                        {r.variacionPct >= 0 ? '↑' : '↓'} {Math.abs(r.variacionPct)}%
                      </p>
                    )}
                  </div>
                </div>
                {/* Proyectado desglosado */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                  <div style={{ textAlign: 'center', padding: '8px 6px', background: r.proyectadoEstaSemana > 0 ? '#fefce8' : '#f9fafb', borderRadius: '6px', border: r.proyectadoEstaSemana > 0 ? '1px solid #fde047' : '1px solid #f3f4f6' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '9px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Próximos 7 días</p>
                    <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: r.proyectadoEstaSemana > 0 ? '#854d0e' : '#9ca3af' }}>
                      {r.proyectadoEstaSemana > 0 ? r.proyectadoEstaSemana.toLocaleString('es-AR') : '—'}
                    </p>
                    {r.cultivo === 'rucula' && r.proyectadoEstaSemana > 0 && (
                      <p style={{ margin: '1px 0 0', fontSize: '9px', color: '#9ca3af' }}>~{r.proyectadoEstaSemanaPlantas.toLocaleString('es-AR')} plantas</p>
                    )}
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px 6px', background: r.proyectadoRestoMes > 0 ? '#f0fdf4' : '#f9fafb', borderRadius: '6px', border: r.proyectadoRestoMes > 0 ? '1px solid #86efac' : '1px solid #f3f4f6' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '9px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Resto del mes</p>
                    <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: r.proyectadoRestoMes > 0 ? '#059669' : '#9ca3af' }}>
                      {r.proyectadoRestoMes > 0 ? r.proyectadoRestoMes.toLocaleString('es-AR') : '—'}
                    </p>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px 6px', background: '#eff6ff', borderRadius: '6px', border: '1px solid #93c5fd' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '9px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Total mes est.</p>
                    <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1d4ed8' }}>
                      {(r.cosechadoMes + r.proyectadoMesTotal).toLocaleString('es-AR')}
                    </p>
                    <p style={{ margin: '1px 0 0', fontSize: '9px', color: '#9ca3af' }}>cosech. + proy.</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Gráficos de ciclos — solo F1/F2 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Distribución en mesadas</p>
            <p style={{ margin: '0 0 12px', fontSize: '10px', color: '#9ca3af' }}>Semana de ciclo desde siembra · Solo F1 y F2</p>
            <GraficoCiclos
              titulo="Lechuga"
              color="#4d7c0f"
              colorF1="#86efac"
              colorF2="#16a34a"
              barras={ciclosLechuga.barras}
              semanasCosecha={ciclosLechuga.semanasCosecha}
              semanaActual={0}
            />
          </div>
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Distribución en mesadas</p>
            <p style={{ margin: '0 0 12px', fontSize: '10px', color: '#9ca3af' }}>Semana de ciclo desde siembra · Solo F1 y F2</p>
            <GraficoCiclos
              titulo="Rúcula"
              color="#166534"
              colorF1="#6ee7b7"
              colorF2="#047857"
              barras={ciclosRucula.barras}
              semanasCosecha={ciclosRucula.semanasCosecha}
              semanaActual={0}
              sinF1
            />
          </div>
        </div>

        {/* Acciones rápidas */}
        <div className="card">
          <p className="card-title">Acciones rápidas</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Link href="/cultivos/nuevo" className="btn">+ Nuevo lote</Link>
            <Link href="/ocupacion" className="btn secondary">Ocupación</Link>
            <Link href="/estadisticas" className="btn secondary">Estadísticas</Link>
          </div>
        </div>

        {/* Cuadro de ciclos por cultivo */}
        {tiemposCiclo.length > 0 && (() => {
          const lechuga = tiemposCiclo.filter((t: any) => !String(t.variedad).toLowerCase().includes('rucula'));
          const rucula  = tiemposCiclo.filter((t: any) => String(t.variedad).toLowerCase().includes('rucula'));
          const lAnt    = tiemposCicloAnt.filter((t: any) => !String(t.variedad).toLowerCase().includes('rucula'));
          const rAnt    = tiemposCicloAnt.filter((t: any) => String(t.variedad).toLowerCase().includes('rucula'));

          function promedioTotal(arr: any[]) { if (!arr.length) return 0; return Math.round(arr.reduce((a:any, t:any) => a + t.total, 0) / arr.length); }
          function promedioF1(arr: any[]) { const v = arr.filter((t:any) => t.fase_1 !== null); if (!v.length) return 0; return Math.round(v.reduce((a:any, t:any) => a + t.fase_1, 0) / v.length); }
          function promedioF2(arr: any[]) { if (!arr.length) return 0; return Math.round(arr.reduce((a:any, t:any) => a + t.fase_2, 0) / arr.length); }

          const lTotal = promedioTotal(lechuga); const lAntTotal = promedioTotal(lAnt);
          const rTotal = promedioTotal(rucula);  const rAntTotal = promedioTotal(rAnt);
          const lF1 = promedioF1(lechuga); const lF2 = promedioF2(lechuga);
          const rF2 = promedioF2(rucula);
          const maxDias = Math.max(lTotal, rTotal, 1);

          function varPct(actual: number, ant: number) { if (!ant) return null; return Math.round(((actual - ant) / ant) * 100); }

          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div className="card" style={{ margin: 0 }}>
                <p className="card-title">Ciclos en mesadas — 8 semanas</p>
                <p className="card-sub">Días por fase · sin plantinera</p>
                <GraficoCiclosSemanas datos={ciclosSemanas} />

                {/* KPIs F2 actuales */}
                {(() => {
                  const ult = ciclosSemanas.filter((s: any) => s.lechugaF2 > 0 || s.rucula > 0).slice(-1)[0];
                  const ant = ciclosSemanas.filter((s: any) => s.lechugaF2 > 0 || s.rucula > 0).slice(-2, -1)[0];
                  if (!ult) return null;
                  function varPct(a: number, b: number) { if (!b) return null; return Math.round(((a - b) / b) * 100); }
                  const vL = ant ? varPct(ult.lechugaF2, ant.lechugaF2) : null;
                  const vR = ant ? varPct(ult.rucula, ant.rucula) : null;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f3f4f6' }}>
                      {ult.lechugaF2 > 0 && (
                        <div style={{ textAlign: 'center', padding: '10px', background: '#f7fee7', borderRadius: '8px' }}>
                          <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#4d7c0f', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>Lechuga · F2 actual</p>
                          <p style={{ margin: '0 0 2px', fontSize: '28px', fontWeight: 800, color: '#14532d' }}>{ult.lechugaF2}d</p>
                          {vL !== null && <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: vL <= 0 ? '#059669' : '#dc2626' }}>{vL <= 0 ? '↓' : '↑'} {Math.abs(vL)}% vs sem. ant.</p>}
                        </div>
                      )}
                      {ult.rucula > 0 && (
                        <div style={{ textAlign: 'center', padding: '10px', background: '#f0fdf4', borderRadius: '8px' }}>
                          <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#166534', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>Rúcula · F2 actual</p>
                          <p style={{ margin: '0 0 2px', fontSize: '28px', fontWeight: 800, color: '#14532d' }}>{ult.rucula}d</p>
                          {vR !== null && <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: vR <= 0 ? '#059669' : '#dc2626' }}>{vR <= 0 ? '↓' : '↑'} {Math.abs(vR)}% vs sem. ant.</p>}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="card" style={{ margin: 0 }}>
                <p className="card-title">Últimas cosechas</p>
                <p className="card-sub">Días de ciclo por lote cosechado</p>
                <table style={{ fontSize: '11px' }}>
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th>Variedad</th>
                      <th style={{ textAlign:'right' }}>Plant.</th>
                      <th style={{ textAlign:'right' }}>F1</th>
                      <th style={{ textAlign:'right' }}>F2</th>
                      <th style={{ textAlign:'right' }}>Total</th>
                      <th style={{ textAlign:'right' }}>Cosechado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotes.filter((l: any) => l.estado === 'cosechado' && l.dias_total)
                      .sort((a: any, b: any) => String(b.fecha_cosecha||'').localeCompare(String(a.fecha_cosecha||'')))
                      .slice(0, 8)
                      .map((l: any) => {
                        const esRucula = String(l.variedad||'').toLowerCase().includes('rucula');
                        const unidades = Number(l.unidades_cosechadas) || 0;
                        return (
                          <tr key={l.id_lote}>
                            <td style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700 }}>{l.id_lote}</td>
                            <td style={{ color: '#6b7280' }}>{String(l.variedad||'').split(' ')[0]}</td>
                            <td style={{ textAlign:'right', color: '#9ca3af' }}>{l.dias_plantinera ? l.dias_plantinera+'d' : '—'}</td>
                            <td style={{ textAlign:'right', color: '#9ca3af' }}>{l.dias_f1 ? l.dias_f1+'d' : '—'}</td>
                            <td style={{ textAlign:'right', color: '#9ca3af' }}>{l.dias_f2 ? l.dias_f2+'d' : '—'}</td>
                            <td style={{ textAlign:'right', fontWeight: 600 }}>{l.dias_total}d</td>
                            <td style={{ textAlign:'right', color: esRucula ? '#166534' : '#4d7c0f', fontWeight: 500 }}>
                              {unidades > 0 ? `${unidades} ${esRucula ? 'paq' : 'pl'}` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Lotes con filtros */}
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
        ) : lotesFiltrados.map((lote) => (
          <LoteCard key={lote.id_lote} lote={lote} movimientos={movimientos} ubicaciones={ubicaciones} variedades={variedades} />
        ))}
      </div>
    </>
  );
}

function CultivoCard({ titulo, color, colorBg, datos, variacion, tieneFase1, esRucula }: {
  titulo: string; color: string; colorBg: string;
  datos: { plantinera: number; fase_1: number; fase_2: number; total: number };
  variacion: number | null; tieneFase1: boolean; esRucula?: boolean;
}) {
  const PLANTAS_POR_PAQ = 3;
  const varColor = variacion === null ? '#9ca3af' : variacion > 0 ? '#059669' : '#dc2626';
  // Para rúcula: mostrar paquetes estimados en F2 y total
  const f2Paq = esRucula ? Math.round(datos.fase_2 / PLANTAS_POR_PAQ) : datos.fase_2;
  const totalPaq = esRucula ? Math.round(datos.total / PLANTAS_POR_PAQ) : datos.total;
  const hoy = new Date();
  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderTop: '3px solid ' + color, borderRadius: '10px', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ background: color, color: 'white', padding: '2px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 800, letterSpacing: '0.5px' }}>{titulo.toUpperCase()}</span>
        <span style={{ fontSize: '22px', fontWeight: 700, color: '#111827' }}>
          {esRucula ? (
            <>
              {totalPaq.toLocaleString('es-AR')}
              <span style={{ fontSize: '11px', fontWeight: 400, color: '#6b7280', marginLeft: '4px' }}>paq. est.</span>
              <span style={{ fontSize: '11px', fontWeight: 400, color: '#9ca3af', marginLeft: '6px' }}>({datos.total.toLocaleString('es-AR')} pl)</span>
            </>
          ) : (
            <>{datos.total.toLocaleString('es-AR')}<span style={{ fontSize: '11px', fontWeight: 400, color: '#6b7280', marginLeft: '4px' }}>plantas</span></>
          )}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: tieneFase1 ? '1fr 1fr 1fr' : '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
        {([
          ['Plantinera', datos.plantinera, datos.plantinera],
          ...(tieneFase1 ? [['Fase 1', datos.fase_1, datos.fase_1] as [string,number,number]] : []),
          ['Fase 2', esRucula ? f2Paq : datos.fase_2, datos.fase_2],
        ] as [string, number, number][]).map(([label, val, valPl]) => (
          <div key={label} style={{ background: valPl > 0 ? colorBg : '#f9fafb', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 2px', fontSize: '10px', color: valPl > 0 ? color : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 600 }}>{label}</p>
            <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: valPl > 0 ? '#111827' : '#d1d5db' }}>{val.toLocaleString('es-AR')}</p>
            {esRucula && label === 'Fase 2' && valPl > 0 && (
              <p style={{ margin: '1px 0 0', fontSize: '10px', color: '#9ca3af' }}>{valPl.toLocaleString('es-AR')} pl</p>
            )}
          </div>
        ))}
      </div>
      <div style={{ paddingTop: '10px', borderTop: '1px solid #f3f4f6', fontSize: '12px', color: varColor, fontWeight: 500 }}>
        {variacion === null
          ? <span style={{ color: '#9ca3af', fontWeight: 400 }}>Sin cosechas en período comparable</span>
          : <>{variacion >= 0 ? '↑' : '↓'} {Math.abs(variacion)}% vs cosechas — día 1 al {hoy.getDate()} del mes ant.</>}
      </div>
    </div>
  );
}
