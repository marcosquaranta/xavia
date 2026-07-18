import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorNave, tubosPorMesada } from '@/lib/ocupacion';
import { plantasPorCultivo, proyeccionCosechaSemanal, ciclosPorSemana, cicloRealPorVariedad, pesoPromedioMes, mesAnteriorClamp, cicloMesPromedio } from '@/lib/estadisticas';
import { aplicarFiltros3, contarPorFiltro, type FiltroCultivo, type FiltroFase, type FiltroNave } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad, VentaDia, ClienteVenta, PrecioVenta, VentaHistorica, StockCamara, Articulo, StockMes } from '@/lib/types';
import { calcularPlan, tareasDelDia, siembraDelDia, parseReparto, REPARTO_DEFAULT, type SiembraHoy } from '@/lib/planificacion';
import { calcularCapacidad, diasCicloDefault, trasplantesAgrupados, cosechasAgrupadas, type GrupoLotes } from '@/lib/planificacionServer';
import { evolucionVentaPorArticulo, resumenMesActual } from '@/lib/estadisticasVentas';
import { generarAlertas, alertasStockBajo } from '@/lib/alertasPanel';
import { calcularDriversMes } from '@/lib/usoTeorico';
import { calcularCamara, diferenciaAjustesMes } from '@/lib/camara';
import Header from '@/components/Header';
import FiltrosLotes from '@/components/FiltrosLotes';
import LoteCard from '@/components/LoteCard';
import GraficoCiclosSemanas from '@/components/GraficoCiclosSemanas';
import GraficoDistribucionMesadas from '@/components/GraficoDistribucionMesadas';
import BuscadorLote from '@/components/BuscadorLote';
import GruposLotes from '@/components/GruposLotes';
import AjusteStockCard from '@/components/AjusteStockCard';
import { GraficoVentaPorArticulo } from '@/app/ventas/VentasEvolucionCharts';

export const dynamic = 'force-dynamic';

const LOTES_POR_PAGINA = 4;

const TIPO_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  siembra:    { label: 'Siembra',    color: '#92400e', bg: '#fef9c3' },
  trasplante: { label: 'Trasplante', color: '#1e40af', bg: '#dbeafe' },
  cosecha:    { label: 'Cosecha',    color: '#166534', bg: '#dcfce7' },
  descarte:   { label: 'Descarte',   color: '#6b7280', bg: '#f3f4f6' },
};

function fmtFecha(s: any) {
  const str = String(s||'').split(/[\sT]/)[0];
  if (!str || str === 'undefined') return '—';
  const [y,m,d] = str.split('-'); return `${d}/${m}`;
}
function diasAtras(s: any) {
  try { const diff = Math.round((Date.now() - new Date(String(s||'').split(/[\sT]/)[0]+'T12:00:00').getTime())/86400000); if (diff===0) return 'Hoy'; if (diff===1) return 'Ayer'; return `Hace ${diff}d`; } catch { return ''; }
}

export default async function PanelPage({ searchParams }: {
  searchParams: { cultivo?: string; fase?: string; nave?: string; mesada?: string; tiempo?: string; q?: string; p?: string }
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const cultivo = (searchParams.cultivo || 'todos') as FiltroCultivo;
  const fase    = (searchParams.fase    || 'todas') as FiltroFase;
  const nave    = (searchParams.nave    || 'todas') as FiltroNave;
  const mesada  = searchParams.mesada  || 'todas';
  const tiempo  = (searchParams.tiempo || 'todos') as any;
  const query   = (searchParams.q || '').trim().toLowerCase();
  const pagina  = Math.max(1, parseInt(searchParams.p || '1'));

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [], variedades: Variedad[] = [];
  let ventasPanel: VentaDia[] = [], clientesPanel: ClienteVenta[] = [], preciosPanel: PrecioVenta[] = [], historicasPanel: VentaHistorica[] = [];
  let configRows: { clave: string; valor: any }[] = [];
  let registrosCamara: StockCamara[] = [];
  let articulosPanel: Articulo[] = [], stocksPanel: StockMes[] = [];
  try {
    [lotes, movimientos, ubicaciones, variedades, ventasPanel, clientesPanel, preciosPanel, historicasPanel, configRows, registrosCamara, articulosPanel, stocksPanel] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'), readSheet<Variedad>('Variedades'),
      readSheet<VentaDia>('Ventas'),
      readSheet<ClienteVenta>('Clientes').catch(() => []),
      readSheet<PrecioVenta>('Precios').catch(() => []),
      readSheet<VentaHistorica>('VentasHistoricas').catch(() => []),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
      readSheet<StockCamara>('StockCamara').catch(() => []),
      readSheet<Articulo>('Articulos').catch(() => []),
      readSheet<StockMes>('Stocks').catch(() => []),
    ]);
  } catch {}

  // ── Tareas de hoy (planificación) ──
  let tareasHoy: { icon: string; txt: string; color: string; href?: string }[] = [];
  let gruposTrasplante: GrupoLotes[] = [];
  let gruposCosecha: GrupoLotes[] = [];
  let siembraHoy: SiembraHoy | null = null;
  try {
    const naves = calcularCapacidad(ubicaciones);
    const plan = calcularPlan(naves, diasCicloDefault(lotes, movimientos));
    const cfgRep = configRows.find(i => i.clave === 'plan_reparto');
    const reparto = cfgRep ? parseReparto(cfgRep.valor) : REPARTO_DEFAULT;
    const diaSemana = new Date().getDay();
    tareasHoy = tareasDelDia(plan, reparto, diaSemana);
    siembraHoy = siembraDelDia(plan, reparto, diaSemana);
    if (diaSemana >= 1 && diaSemana <= 6) {
      gruposTrasplante = trasplantesAgrupados(lotes, movimientos);
      gruposCosecha = cosechasAgrupadas(lotes, movimientos);
    }
  } catch {}

  // Datos del panel
  let navesOcup: any[] = [], tubosMesadas: any[] = [];
  let resumen = { lechuga: { plantinera:0,fase_1:0,fase_2:0,total:0 }, rucula: { plantinera:0,fase_1:0,fase_2:0,total:0 }, albahaca: { plantinera:0,fase_1:0,fase_2:0,total:0 } };
  let proyeccionCosecha: any[] = [];
  let ciclosSemanas: any[] = [];
  let ciclosRealesMap = new Map<string,number>();

  try {
    navesOcup     = ocupacionPorNave(ubicaciones, lotes);
    tubosMesadas  = tubosPorMesada(ubicaciones, lotes);
    resumen       = plantasPorCultivo(lotes);
    proyeccionCosecha = proyeccionCosechaSemanal(lotes, variedades, 8);
    ciclosSemanas  = ciclosPorSemana(lotes, movimientos);
    ciclosRealesMap = cicloRealPorVariedad(lotes, [], 5);
  } catch {}

  // ── Evolución de venta por artículo + indicadores del mes (mismo cálculo que Ventas) ──
  const evolArticuloPanel = evolucionVentaPorArticulo(ventasPanel, 12, historicasPanel);
  const ahora = new Date();
  const mesPasadoRef = mesAnteriorClamp(ahora);
  const resumenMesPanel = resumenMesActual(ventasPanel, preciosPanel, clientesPanel, ahora);
  // Mes pasado completo, para comparar contra la proyección (que estima un mes entero).
  // OJO: sin el diaCorte explícito acá, resumenMesActual usa mesPasadoRef.getDate() como
  // corte (el mismo día que hoy) en vez del mes completo — quedaba idéntico al
  // "comparable" de abajo e inflaba la variación de la proyección.
  const diasEnMesPasado = new Date(mesPasadoRef.getFullYear(), mesPasadoRef.getMonth() + 1, 0).getDate();
  const resumenMesPasadoCompleto = resumenMesActual(ventasPanel, preciosPanel, clientesPanel, mesPasadoRef, diasEnMesPasado);
  // Referencia para "venta al día": el RITMO de todo el mes pasado (total real / días del mes),
  // prorrateado a los días que ya pasaron este mes — NO el total real de "mes pasado, mismos
  // primeros N días", que quedaba a merced de en qué día cayó algún pedido grande de un
  // cliente (un pedido grande cayendo del lado equivocado del corte disparaba el % de forma
  // errática, igual que ya pasaba con las ventas por kg — ver KEYS_EXCLUIDAS_UNIDADES).
  const corteHoy = ahora.getDate();
  const ventaEsperadaAlDia = diasEnMesPasado > 0 ? resumenMesPasadoCompleto.unidadesMes * (corteHoy / diasEnMesPasado) : 0;
  const pesoMesPanel = pesoPromedioMes(lotes, ahora);
  const pesoMesPasadoPanel = pesoPromedioMes(lotes, mesPasadoRef, ahora.getDate());

  // ── Stock en cámara + diferencia acumulada de ajustes del mes ──
  const camaraRucula = calcularCamara('rucula', registrosCamara, lotes, ventasPanel);
  const camaraLechuga = calcularCamara('lechuga', registrosCamara, lotes, ventasPanel);
  const ajusteMesRucula = diferenciaAjustesMes('rucula', registrosCamara, lotes, ventasPanel, ahora);
  const ajusteMesLechuga = diferenciaAjustesMes('lechuga', registrosCamara, lotes, ventasPanel, ahora);
  const ajusteMesRuculaPasado = diferenciaAjustesMes('rucula', registrosCamara, lotes, ventasPanel, mesPasadoRef);
  const ajusteMesLechugaPasado = diferenciaAjustesMes('lechuga', registrosCamara, lotes, ventasPanel, mesPasadoRef);
  const faltanteMesTotal = ajusteMesRucula.acumulado + ajusteMesLechuga.acumulado;
  const faltanteMesTotalPasado = ajusteMesRuculaPasado.acumulado + ajusteMesLechugaPasado.acumulado;

  const ocupNaves = tubosMesadas.map((n: any) => {
    const f2 = (n.mesadas || []).filter((m: any) => m.sector_fase !== 'fase_1');
    const tot = f2.reduce((s: number, m: any) => s + m.tubos_totales, 0);
    const ocu = f2.reduce((s: number, m: any) => s + m.tubos_ocupados, 0);
    return { nave: n.nave, pct: tot > 0 ? Math.round(ocu / tot * 100) : 0 };
  });
  // % de variación vs. la referencia de "mes pasado" que corresponda a cada indicador.
  function pctVs(actual: number, ref: number): number | null {
    if (!ref) return null;
    return Math.round(((actual - ref) / ref) * 100);
  }

  // Ocupación solo F2
  const mesadasF2 = tubosMesadas.flatMap((n:any) => (n.mesadas||[]).filter((m:any) => m.sector_fase !== 'fase_1'));
  const ocGlobal = mesadasF2.length > 0
    ? Math.round(mesadasF2.reduce((a:number,m:any)=>a+m.tubos_ocupados,0) /
      Math.max(1, mesadasF2.reduce((a:number,m:any)=>a+m.tubos_totales,0)) * 100)
    : 0;

  // ── ALERTAS ──
  const hoy = new Date();
  // Stock de insumos por debajo de 15 días de uso — mismos drivers de producción/venta que
  // alimentan el "Uso Teórico" de Stocks, ver lib/alertasPanel.ts (alertasStockBajo).
  const driversStockActual = calcularDriversMes(lotes, ventasPanel, preciosPanel, clientesPanel, ahora.getFullYear(), ahora.getMonth() + 1);
  const driversStockMesAnterior = calcularDriversMes(lotes, ventasPanel, preciosPanel, clientesPanel, mesPasadoRef.getFullYear(), mesPasadoRef.getMonth() + 1);
  const alertasStock = alertasStockBajo(articulosPanel, stocksPanel, driversStockActual, driversStockMesAnterior, ahora.getFullYear(), ahora.getMonth() + 1, diasEnMesPasado, 15);
  const alertas = [...generarAlertas(lotes, tubosMesadas, ciclosRealesMap, ocGlobal), ...alertasStock].sort((a, b) => {
    const pa = a.prioridad ?? ({ error: 1, warn: 2, info: 3 } as any)[a.tipo];
    const pb = b.prioridad ?? ({ error: 1, warn: 2, info: 3 } as any)[b.tipo];
    return pa - pb;
  });

  // Desvíos de cosecha (antes en la sección "Alertas" propia, ahora solo en el home) —
  // solo admin, últimos 30 días, sin revisar primero.
  const cosechasConAlerta = movimientos.filter((m) => {
    if (m.tipo !== 'cosecha') return false;
    if (m.nivel_alerta !== 'amarillo' && m.nivel_alerta !== 'rojo') return false;
    try { const f = new Date(String(m.fecha)); return (hoy.getTime() - f.getTime()) / 86400000 <= 30; } catch { return true; }
  }).sort((a, b) => {
    const aRev = a.alerta_revisada === 'SI', bRev = b.alerta_revisada === 'SI';
    if (aRev !== bRev) return aRev ? 1 : -1;
    if (a.nivel_alerta !== b.nivel_alerta) return a.nivel_alerta === 'rojo' ? -1 : 1;
    return String(b.fecha || '').localeCompare(String(a.fecha || ''));
  });

  // ── ÚLTIMOS MOVIMIENTOS, separados por tipo ──
  const lotesMap = new Map(lotes.map(l => [l.id_lote, l]));
  const movsOrdenados = [...movimientos]
    .filter(m => m.fecha)
    .sort((a,b) => String(b.fecha||'').localeCompare(String(a.fecha||'')));
  const ultimasCosechas = movsOrdenados.filter(m => m.tipo === 'cosecha').slice(0, 4);
  const ultimosTrasplantes = movsOrdenados.filter(m => m.tipo === 'trasplante').slice(0, 4);
  const ultimasSiembras = movsOrdenados.filter(m => m.tipo === 'siembra').slice(0, 4);

  function filaMov(m: Movimiento) {
    const lote = lotesMap.get(String(m.id_lote||''));
    const t = TIPO_LABEL[String(m.tipo||'')] || TIPO_LABEL.descarte;
    const varNorm = String(lote?.variedad||'').toLowerCase();
    const esR = varNorm.includes('rucula')||varNorm.includes('rúcula');
    const cantU = Number(m.unidades_cosechadas||0);
    const cantP = Number(m.plantas_estimadas||0);
    const unidadesStr = m.tipo==='cosecha' && esR && cantU>0
      ? `${cantU.toLocaleString('es-AR')} paq. (${cantP.toLocaleString('es-AR')} pl)`
      : m.tipo==='cosecha' && cantU>0 ? `${cantU.toLocaleString('es-AR')} pl`
      : cantP>0 ? `${cantP.toLocaleString('es-AR')} pl` : '';
    return (
      <div key={m.id_movimiento} style={{ display:'flex', alignItems:'center', gap:'7px', padding:'6px 8px', background:'#fafafa', borderRadius:'6px', borderLeft:`3px solid ${t.color}` }}>
        <span style={{ background:t.bg, color:t.color, fontSize:'9px', fontWeight:700, padding:'1px 5px', borderRadius:'3px', minWidth:'65px', textAlign:'center' }}>{t.label}</span>
        <Link href={`/cultivos/${encodeURIComponent(String(m.id_lote||''))}`} style={{ textDecoration:'none' }}>
          <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:'11px', color:'#111827' }}>{m.id_lote}</span>
        </Link>
        {lote?.variedad && (
          <span style={{ fontSize:'11px', color:esR?'#166534':'#4d7c0f', fontWeight:500 }}>
            {String(lote.variedad).split(' ')[0]}
          </span>
        )}
        {unidadesStr && <span style={{ fontSize:'11px', color:'#6b7280', marginLeft:'auto' }}>{unidadesStr}</span>}
        <span style={{ fontSize:'10px', color:'#9ca3af', whiteSpace:'nowrap' }}>{diasAtras(m.fecha)}</span>
      </div>
    );
  }

  // ── KPIs F2 ──
  const ultSem = ciclosSemanas.filter((s:any) => s.lechugaF2>0||s.rucula>0).slice(-1)[0];
  const antSem = ciclosSemanas.filter((s:any) => s.lechugaF2>0||s.rucula>0).slice(-2,-1)[0];
  function varPctSem(a:number,b:number){if(!b||!a)return null;return Math.round(((a-b)/b)*100);}
  // Respaldo cuando no hay comparación semana a semana (0 cosechas esa semana puntual —
  // muy común en lechuga, que tiene un ciclo mucho más largo que rúcula): comparar contra
  // el promedio del mes pasado en vez de dejar el indicador sin ningún %.
  const cicloMesPasado = cicloMesPromedio(lotes, movimientos, mesPasadoRef);
  // Última semana CON cosechas de cada cultivo (puede no ser "esta semana" — 0 cosechas
  // puntuales de lechuga esa semana es normal por su ciclo largo). Evita que la tarjeta
  // de "Lechuga F2"/"Rúcula F2" desaparezca entera cuando esta semana puntual da 0.
  const ultimoLechugaF2 = ciclosSemanas.filter((s:any) => s.lechugaF2 > 0).slice(-1)[0]?.lechugaF2;
  const ultimoRuculaF2  = ciclosSemanas.filter((s:any) => s.rucula > 0).slice(-1)[0]?.rucula;

  // ── LOTES FILTRADOS CON PAGINACIÓN ──
  const conteos = contarPorFiltro(lotes, nave, ubicaciones);
  const lotesFiltrados = query
    ? lotes.filter(l => String(l.id_lote||'').toLowerCase().includes(query))
    : aplicarFiltros3(lotes, cultivo, fase, nave, mesada, tiempo, ubicaciones);
  const totalPaginas = Math.ceil(lotesFiltrados.length / LOTES_POR_PAGINA);
  const lotesEnPagina = lotesFiltrados.slice((pagina-1)*LOTES_POR_PAGINA, pagina*LOTES_POR_PAGINA);

  function urlPagina(p: number) {
    const params = new URLSearchParams();
    if (cultivo !== 'todos') params.set('cultivo', cultivo);
    if (fase !== 'todas') params.set('fase', fase);
    if (nave !== 'todas') params.set('nave', nave);
    if (mesada !== 'todas') params.set('mesada', mesada);
    if (tiempo !== 'todos') params.set('tiempo', tiempo);
    if (p > 1) params.set('p', String(p));
    const s = params.toString();
    return `/panel${s ? '?' + s : ''}`;
  }

  const hoyStr = new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });

  return (
    <>
      <Header user={user} current="panel" />
      <div className="container">
        <h1 className="page-title">Panel de control</h1>
        <p className="page-subtitle">{hoyStr.charAt(0).toUpperCase()+hoyStr.slice(1)} · Bienvenido, {user.nombre}</p>

        {/* ══ TAREAS DE HOY ══ */}
        <div style={{ background:'linear-gradient(135deg,#eff6ff,#f0fdf4)', border:'1px solid #bfdbfe', borderRadius:'10px', padding:'14px', marginBottom:'14px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'8px', flexWrap:'wrap', gap:'4px' }}>
              <p style={{ margin:0, fontSize:'14px', fontWeight:800 }}>📋 Tareas de hoy</p>
              {user.rol === 'admin' && (
                <Link href="/planificacion" style={{ fontSize:'11px', color:'#6b7280', textDecoration:'none' }}>Planificación →</Link>
              )}
            </div>
            <div style={{ background:'white', borderRadius:'7px', padding:'10px 12px', border:'1px solid #e5e7eb', marginBottom:'10px' }}>
                <p style={{ margin:'0 0 8px', fontSize:'13px', fontWeight:700 }}>⚠️ Alertas</p>
                {alertas.length === 0 ? (
                  <p style={{ margin:0, color:'#059669', fontSize:'12px', fontWeight:600 }}>✓ Sin alertas activas</p>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:'6px', maxHeight:'180px', overflowY:'auto' }}>
                    {alertas.map((a,i) => (
                      <div key={i} style={{ fontSize:'11px', padding:'5px 8px', borderRadius:'5px', background:a.tipo==='error'?'#fef2f2':a.tipo==='warn'?'#fffbeb':'#eff6ff', color:a.tipo==='error'?'#dc2626':a.tipo==='warn'?'#92400e':'#1d4ed8', display:'flex', alignItems:'center', gap:'5px' }}>
                        {a.tipo==='error'?'🔴':a.tipo==='warn'?'🟡':'🔵'}
                        {a.lote ? (
                          <Link href={`/cultivos/${encodeURIComponent(a.lote)}`} style={{ textDecoration:'none', color:'inherit', fontWeight:600 }}>{a.msg}</Link>
                        ) : a.msg}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop:'10px', paddingTop:'8px', borderTop:'1px solid #f3f4f6', fontSize:'11px', color:'#6b7280' }}>
                  Ocup. global (F2): <strong>{ocGlobal}%</strong>
                  {tubosMesadas.map((n:any) => { const f2=(n.mesadas||[]).filter((m:any)=>m.sector_fase!=='fase_1'); const tot=f2.reduce((s:number,m:any)=>s+m.tubos_totales,0); const ocu=f2.reduce((s:number,m:any)=>s+m.tubos_ocupados,0); const pct=tot>0?Math.round(ocu/tot*100):0; return <span key={n.nave}> · N{n.nave}: <strong>{pct}%</strong></span>; })}
                </div>
            </div>
            {user.rol === 'admin' && cosechasConAlerta.length > 0 && (
              <div style={{ background:'white', borderRadius:'7px', padding:'10px 12px', border:'1px solid #e5e7eb', marginBottom:'10px' }}>
                <p style={{ margin:'0 0 8px', fontSize:'13px', fontWeight:700 }}>⚠️ Desvíos de cosecha <span style={{ fontWeight:400, fontSize:'11px', color:'#9ca3af' }}>(30 días)</span></p>
                <div style={{ display:'flex', flexDirection:'column', gap:'6px', maxHeight:'220px', overflowY:'auto' }}>
                  {cosechasConAlerta.map((m) => {
                    const esRoja = m.nivel_alerta === 'rojo';
                    const esRev = m.alerta_revisada === 'SI';
                    return (
                      <div key={m.id_movimiento} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'6px 8px', borderRadius:'6px', background: esRev ? '#f9fafb' : esRoja ? '#fef2f2' : '#fffbeb', opacity: esRev ? 0.7 : 1 }}>
                        <span style={{ background: esRev ? '#e5e7eb' : esRoja ? '#dc2626' : '#d97706', color: esRev ? '#6b7280' : 'white', padding:'1px 7px', borderRadius:'8px', fontSize:'10px', fontWeight:700, flexShrink:0 }}>
                          +{Math.round(Number(m.desvio_porcentaje) || 0)}%
                        </span>
                        <Link href={`/cultivos/${encodeURIComponent(String(m.id_lote||''))}`} style={{ textDecoration:'none', fontFamily:'monospace', fontWeight:700, fontSize:'11px', color:'#111827' }}>
                          {m.id_lote}
                        </Link>
                        <span style={{ fontSize:'11px', color:'#6b7280', flex:1 }}>
                          {fmtFecha(String(m.fecha||''))} · {Number(m.unidades_cosechadas)||0}u · {Number(m.descarte_calculado)||0} s/id
                          {esRev && <span style={{ color:'#059669', marginLeft:'6px' }}>✓ Revisada</span>}
                        </span>
                        {!esRev && <Link href={'/alertas/' + m.id_movimiento + '/revisar'} className="btn secondary small" style={{ flexShrink:0 }}>Revisar</Link>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {siembraHoy && (
              <div style={{ background:'white', borderRadius:'7px', padding:'10px 12px', border:'1px solid #e5e7eb', marginBottom:'10px' }}>
                <p style={{ margin:'0 0 8px', fontSize:'13px', fontWeight:700 }}>🌱 Sembrar hoy</p>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:'10px' }}>
                  <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'7px', padding:'8px 12px', textAlign:'center' }}>
                    <p style={{ margin:0, fontSize:'26px', fontWeight:900, color:'#ca8a04', lineHeight:1 }}>{siembraHoy.rucPl}</p>
                    <p style={{ margin:'2px 0 0', fontSize:'10px', color:'#92400e', fontWeight:600, textTransform:'uppercase' }}>planchas rúcula</p>
                  </div>
                  <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:'7px', padding:'8px 12px', textAlign:'center' }}>
                    <p style={{ margin:0, fontSize:'26px', fontWeight:900, color:'#4d7c0f', lineHeight:1 }}>{siembraHoy.lecPl}</p>
                    <p style={{ margin:'2px 0 0', fontSize:'10px', color:'#166534', fontWeight:600, textTransform:'uppercase' }}>planchas lechuga</p>
                  </div>
                </div>
              </div>
            )}
            {tareasHoy.length > 0 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:'7px', marginBottom: (gruposTrasplante.length > 0 || gruposCosecha.length > 0) ? '10px' : 0 }}>
                {tareasHoy.map((t,i) => {
                  const contenido = (<><span style={{ fontSize:'14px' }}>{t.icon}</span><span style={{ color:'#374151' }}>{t.txt}</span></>);
                  const estilo: React.CSSProperties = { display:'flex', gap:'8px', alignItems:'flex-start', fontSize:'12.5px', lineHeight:1.4, background:'white', borderRadius:'7px', padding:'7px 10px', border:'1px solid #e5e7eb' };
                  return t.href
                    ? <Link key={i} href={t.href} style={{ ...estilo, textDecoration:'none' }}>{contenido}</Link>
                    : <div key={i} style={estilo}>{contenido}</div>;
                })}
              </div>
            )}
            {(gruposCosecha.length > 0 || gruposTrasplante.length > 0) && (
              <div style={{ background:'white', borderRadius:'7px', padding:'10px 12px', border:'1px solid #e5e7eb', display:'flex', flexDirection:'column', gap:'14px' }}>
                {gruposCosecha.length > 0 && <GruposLotes grupos={gruposCosecha} icono="🌾" etiqueta="Cosechar" />}
                {gruposTrasplante.length > 0 && <GruposLotes grupos={gruposTrasplante} icono="🔄" etiqueta="Trasplantar" />}
              </div>
            )}
        </div>

        {/* ══ FILA 1: VENTAS + INDICADORES ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'14px' }}>
          <GraficoVentaPorArticulo datos={evolArticuloPanel} />
          <div style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px' }}>
            <p style={{ margin:'0 0 12px', fontSize:'13px', fontWeight:700, color:'#111827' }}>Indicadores</p>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
              {[
                { label: 'Venta total mes al día', valor: `${resumenMesPanel.unidadesMes.toLocaleString('es-AR')} u`,
                  pct: pctVs(resumenMesPanel.unidadesMes, ventaEsperadaAlDia), mejorSiSube: true },
                { label: 'Venta total mes proyectada', valor: `${resumenMesPanel.proyeccionMes.toLocaleString('es-AR')} u`,
                  pct: pctVs(resumenMesPanel.proyeccionMes, resumenMesPasadoCompleto.unidadesMes), mejorSiSube: true },
                { label: 'Ciclo actual rúcula', valor: ultSem?.rucula ? `${ultSem.rucula}d` : '—',
                  pct: varPctSem(ultSem?.rucula, antSem?.rucula) ?? varPctSem(ultSem?.rucula, cicloMesPasado.rucula), mejorSiSube: false },
                { label: 'Ciclo actual lechuga', valor: ultSem?.lechugaF2 ? `${ultSem.lechugaF2}d` : '—',
                  pct: varPctSem(ultSem?.lechugaF2, antSem?.lechugaF2) ?? varPctSem(ultSem?.lechugaF2, cicloMesPasado.lechuga), mejorSiSube: false },
                { label: 'Precio promedio actual', valor: `$${Math.round(resumenMesPanel.precioPromedioMes).toLocaleString('es-AR')}`,
                  pct: pctVs(resumenMesPanel.precioPromedioMes, resumenMesPasadoCompleto.precioPromedioMes), mejorSiSube: true },
                { label: 'Peso promedio rúcula (paq)', valor: pesoMesPanel.rucula > 0 ? `${pesoMesPanel.rucula}g` : '—',
                  pct: pctVs(pesoMesPanel.rucula, pesoMesPasadoPanel.rucula), mejorSiSube: true },
                { label: 'Peso promedio lechuga (paq)', valor: pesoMesPanel.lechuga > 0 ? `${pesoMesPanel.lechuga}g` : '—',
                  pct: pctVs(pesoMesPanel.lechuga, pesoMesPasadoPanel.lechuga), mejorSiSube: true },
                { label: 'Faltante de stock (mes)', valor: `${faltanteMesTotal>=0?'+':''}${faltanteMesTotal} paq`,
                  pct: faltanteMesTotalPasado || faltanteMesTotal ? faltanteMesTotal - faltanteMesTotalPasado : null, mejorSiSube: true, sufijo: 'paq' as const },
                { label: 'Ocupación N1', valor: `${ocupNaves.find((n:any)=>n.nave===1)?.pct ?? 0}%`, pct: null, mejorSiSube: true },
                { label: 'Ocupación N2', valor: `${ocupNaves.find((n:any)=>n.nave===2)?.pct ?? 0}%`, pct: null, mejorSiSube: true },
              ].map((it: any) => {
                const bueno = it.pct === null ? null : it.mejorSiSube ? it.pct > 0 : it.pct < 0;
                return (
                  <div key={it.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', borderBottom:'1px solid #f1f0eb', paddingBottom:'6px' }}>
                    <span style={{ fontSize:'11.5px', color:'#52514e' }}>{it.label}</span>
                    <span style={{ display:'flex', alignItems:'baseline', gap:'6px' }}>
                      <strong style={{ fontSize:'15px', color:'#111827' }}>{it.valor}</strong>
                      {it.pct !== null && (
                        <span style={{ fontSize:'10px', fontWeight:700, color: bueno===null?'#9ca3af':bueno?'#059669':'#dc2626' }}>
                          {it.pct > 0 ? '↑' : it.pct < 0 ? '↓' : '·'} {Math.abs(it.pct)}{it.sufijo === 'paq' ? ' paq' : '%'}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <p style={{ margin:'10px 0 0', fontSize:'10px', color:'#9ca3af' }}>% vs. mes pasado (ocupación: sin histórico para comparar)</p>
          </div>
        </div>

        {/* ══ FILA 2: CICLOS + ÚLTIMOS MOVIMIENTOS ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'14px', alignItems:'start' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            <div className="card" style={{ margin:0 }}>
              <p className="card-title">Ciclos en mesadas — 8 semanas</p>
              <p className="card-sub">Días promedio F2 por semana · sin plantinera</p>
              <GraficoCiclosSemanas datos={ciclosSemanas} />
              {ultSem && (() => {
                const lechugaEsEstaSem = ultSem.lechugaF2 > 0;
                const lechugaVal = lechugaEsEstaSem ? ultSem.lechugaF2 : ultimoLechugaF2;
                const lechugaPct = lechugaEsEstaSem
                  ? (varPctSem(ultSem.lechugaF2, antSem?.lechugaF2) ?? varPctSem(ultSem.lechugaF2, cicloMesPasado.lechuga))
                  : null;
                const ruculaEsEstaSem = ultSem.rucula > 0;
                const ruculaVal = ruculaEsEstaSem ? ultSem.rucula : ultimoRuculaF2;
                const ruculaPct = ruculaEsEstaSem
                  ? (varPctSem(ultSem.rucula, antSem?.rucula) ?? varPctSem(ultSem.rucula, cicloMesPasado.rucula))
                  : null;
                return (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginTop:'10px', paddingTop:'10px', borderTop:'1px solid #f3f4f6' }}>
                    {lechugaVal > 0 && (
                      <div style={{ textAlign:'center', padding:'8px', background:'#f7fee7', borderRadius:'7px' }}>
                        <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#4d7c0f', fontWeight:700 }}>Lechuga F2</p>
                        <p style={{ margin:'0 0 1px', fontSize:'22px', fontWeight:800, color:'#14532d' }}>{lechugaVal}d</p>
                        {lechugaPct !== null ? (
                          <p style={{ margin:0, fontSize:'10px', fontWeight:600, color:lechugaPct<=0?'#059669':'#dc2626' }}>
                            {lechugaPct<=0?'↓':'↑'} {Math.abs(lechugaPct)}%
                          </p>
                        ) : (
                          <p style={{ margin:0, fontSize:'10px', color:'#9ca3af' }}>sin cosecha esta sem.</p>
                        )}
                      </div>
                    )}
                    {ruculaVal > 0 && (
                      <div style={{ textAlign:'center', padding:'8px', background:'#f0fdf4', borderRadius:'7px' }}>
                        <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#166534', fontWeight:700 }}>Rúcula F2</p>
                        <p style={{ margin:'0 0 1px', fontSize:'22px', fontWeight:800, color:'#14532d' }}>{ruculaVal}d</p>
                        {ruculaPct !== null ? (
                          <p style={{ margin:0, fontSize:'10px', fontWeight:600, color:ruculaPct<=0?'#059669':'#dc2626' }}>
                            {ruculaPct<=0?'↓':'↑'} {Math.abs(ruculaPct)}%
                          </p>
                        ) : (
                          <p style={{ margin:0, fontSize:'10px', color:'#9ca3af' }}>sin cosecha esta sem.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <AjusteStockCard
              rucula={{ actual: camaraRucula.stockActual, ajusteMes: ajusteMesRucula.acumulado }}
              lechuga={{ actual: camaraLechuga.stockActual, ajusteMes: ajusteMesLechuga.acumulado }}
              esAdmin={user.rol === 'admin'}
            />
          </div>

          {/* Últimos movimientos, por tipo */}
          <div className="card" style={{ margin:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
              <p className="card-title" style={{ margin:0 }}>Últimos movimientos</p>
              <Link href="/movimientos" style={{ fontSize:'11px', color:'#6b7280', textDecoration:'none' }}>Ver todos →</Link>
            </div>
            {ultimasCosechas.length===0 && ultimosTrasplantes.length===0 && ultimasSiembras.length===0 ? (
              <p style={{ color:'#9ca3af', fontSize:'12px', textAlign:'center', padding:'20px' }}>Sin movimientos</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                {[
                  { titulo: '🌾 Últimas cosechas', movs: ultimasCosechas },
                  { titulo: '🔄 Últimos trasplantes', movs: ultimosTrasplantes },
                  { titulo: '🌱 Últimas siembras', movs: ultimasSiembras },
                ].map(({ titulo, movs }) => movs.length > 0 && (
                  <div key={titulo}>
                    <p style={{ margin:'0 0 5px', fontSize:'10px', color:'#6b7280', fontWeight:700, textTransform:'uppercase' }}>{titulo}</p>
                    <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
                      {movs.map(filaMov)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ══ FILA 3: PROYECCIÓN DE COSECHA SEMANAL ══ */}
        <div style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px', marginBottom:'14px' }}>
          <p style={{ margin:'0 0 3px', fontSize:'11px', color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.3px' }}>Proyección de cosecha semanal</p>
          <p style={{ margin:'0 0 10px', fontSize:'10px', color:'#9ca3af' }}>Paquetes esperados por semana · rúcula vs. lechuga</p>
          <GraficoDistribucionMesadas datos={proyeccionCosecha} />
        </div>

        {/* ══ FILA 4: OCUPACIÓN POR MESADA ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'14px' }}>
          {tubosMesadas.map((nave: any) => (
            <div key={nave.nave} style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'12px' }}>
              {(() => { const f2=(nave.mesadas||[]).filter((m:any)=>m.sector_fase!=='fase_1'); const tot=f2.reduce((s:number,m:any)=>s+m.tubos_totales,0); const ocu=f2.reduce((s:number,m:any)=>s+m.tubos_ocupados,0); const pct=tot>0?Math.round(ocu/tot*100):0; return (<>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                <span style={{ background:nave.nave===1?'#881337':'#7c3aed', color:'white', padding:'2px 10px', borderRadius:'5px', fontSize:'12px', fontWeight:700 }}>NAVE {nave.nave}</span>
                <span style={{ fontSize:'11px', color:'#6b7280' }}>{ocu}/{tot} · <strong>{pct}%</strong></span>
              </div>
              <div style={{ height:'4px', background:'#f3f4f6', borderRadius:'2px', overflow:'hidden', marginBottom:'8px' }}>
                <div style={{ width:Math.min(100,pct)+'%', height:'100%', background:nave.nave===1?'#881337':'#7c3aed' }} />
              </div>
              </>); })()}
              <table style={{ fontSize:'11px' }}>
                <thead><tr>
                  <th style={{ textAlign:'left', padding:'3px 6px' }}>Mesada</th>
                  <th style={{ textAlign:'right' }}>Tot.</th>
                  <th style={{ textAlign:'right' }}>Ocup.</th>
                  <th style={{ textAlign:'right' }}>Lib.</th>
                  <th style={{ textAlign:'right' }}>%</th>
                </tr></thead>
                <tbody>
                  {(nave.mesadas||[]).filter((m:any)=>m.sector_fase!=='fase_1').map((m: any) => (
                    <tr key={m.id_ubicacion}>
                      <td style={{ padding:'3px 6px', fontWeight:500 }}>{m.nombre.replace(/^Nave \d+ - /,'').replace(' (F2)','')}</td>
                      <td style={{ textAlign:'right', color:'#6b7280' }}>{m.tubos_totales}</td>
                      <td style={{ textAlign:'right', fontWeight:600 }}>{m.tubos_ocupados}</td>
                      <td style={{ textAlign:'right', color:m.tubos_libres>0?'#059669':'#9ca3af' }}>{m.tubos_libres}</td>
                      <td style={{ textAlign:'right', fontWeight:600, color:m.ocupacion_pct>=80?'#059669':m.ocupacion_pct>=40?'#d97706':'#9ca3af' }}>{m.ocupacion_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* ══ ACCIONES RÁPIDAS ══ */}
        <div className="card" style={{ marginBottom:'14px' }}>
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', alignItems:'center' }}>
            <Link href="/cultivos/nuevo" className="btn">+ Nuevo lote</Link>
            <Link href="/ocupacion" className="btn secondary">Ocupación</Link>
            {user.rol === 'admin' && <Link href="/estadisticas" className="btn secondary">Estadísticas</Link>}
            <Link href="/movimientos" className="btn secondary">Actividad</Link>
          </div>
        </div>

        {/* ══ LOTES CON FILTROS Y PAGINACIÓN ══ */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
          <h2 style={{ margin:0, fontSize:'16px', fontWeight:600 }}>
            Cultivos activos {lotesFiltrados.length > 0 && `(${lotesFiltrados.length})`}
          </h2>
          {lotesFiltrados.length > 0 && (
            <Link href="/cultivos" style={{ fontSize:'12px', color:'#6b7280', textDecoration:'none' }}>Ver todos →</Link>
          )}
        </div>
        <BuscadorLote baseUrl="/panel" />
        {!query && (
          <FiltrosLotes cultivoActivo={cultivo} faseActiva={fase} naveActiva={nave} mesadaActiva={mesada}
            tiempoActivo={tiempo} conteos={conteos} ubicaciones={ubicaciones} baseUrl="/panel" />
        )}
        {query && <p style={{ fontSize:'12px', color:'#6b7280', marginBottom:'10px' }}>{lotesFiltrados.length} resultado{lotesFiltrados.length!==1?'s':''} para "{searchParams.q}"</p>}

        {lotesFiltrados.length === 0 ? (
          <div className="card" style={{ textAlign:'center', padding:'40px' }}>
            <p style={{ margin:0, color:'#6b7280' }}>No hay lotes con este filtro.</p>
            <Link href="/cultivos/nuevo" className="btn" style={{ marginTop:'14px', display:'inline-block' }}>+ Crear lote</Link>
          </div>
        ) : (
          <>
            {lotesEnPagina.map(lote => (
              <LoteCard key={lote.id_lote} lote={lote} movimientos={movimientos} ubicaciones={ubicaciones} variedades={variedades} ciclosReales={ciclosRealesMap} />
            ))}

            {/* Paginación */}
            {totalPaginas > 1 && (
              <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:'8px', marginTop:'16px', paddingTop:'16px', borderTop:'1px solid #f3f4f6' }}>
                {pagina > 1 && (
                  <Link href={urlPagina(pagina-1)} className="btn secondary" style={{ fontSize:'12px', padding:'6px 14px' }}>← Anterior</Link>
                )}
                <span style={{ fontSize:'12px', color:'#6b7280' }}>
                  Página {pagina} de {totalPaginas} · {lotesFiltrados.length} lotes
                </span>
                {pagina < totalPaginas && (
                  <Link href={urlPagina(pagina+1)} className="btn secondary" style={{ fontSize:'12px', padding:'6px 14px' }}>Siguiente →</Link>
                )}
                <Link href="/cultivos" className="btn secondary" style={{ fontSize:'12px', padding:'6px 14px' }}>Ver todos</Link>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
