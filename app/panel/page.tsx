import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorNave, tubosPorMesada } from '@/lib/ocupacion';
import { cosechadoEsteMes, plantasPorCultivo, distribucionPorSemana, resumenCosechaPorCultivo, ciclosPorSemana, cicloRealPorVariedad } from '@/lib/estadisticas';
import { aplicarFiltros3, contarPorFiltro, type FiltroCultivo, type FiltroFase, type FiltroNave } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad, VentaDia, StockCamara } from '@/lib/types';
import { calcularCamara } from '@/lib/camara';
import Header from '@/components/Header';
import FiltrosLotes from '@/components/FiltrosLotes';
import LoteCard from '@/components/LoteCard';
import GraficoCiclos from '@/components/GraficoCiclos';
import GraficoCiclosSemanas from '@/components/GraficoCiclosSemanas';
import BuscadorLote from '@/components/BuscadorLote';

export const dynamic = 'force-dynamic';

const LOTES_POR_PAGINA = 10;

const TIPO_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  siembra:    { label: 'Siembra',    color: '#92400e', bg: '#fef9c3' },
  trasplante: { label: 'Trasplante', color: '#1e40af', bg: '#dbeafe' },
  cosecha:    { label: 'Cosecha',    color: '#166534', bg: '#dcfce7' },
  descarte:   { label: 'Descarte',   color: '#6b7280', bg: '#f3f4f6' },
};

function safeDate(s: any) {
  try { const str = String(s||'').split(/[\sT]/)[0]; return str ? new Date(str+'T12:00:00') : null; } catch { return null; }
}
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
  let ventasPanel: VentaDia[] = [], registrosCamara: StockCamara[] = [];
  try {
    [lotes, movimientos, ubicaciones, variedades, ventasPanel, registrosCamara] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'), readSheet<Variedad>('Variedades'),
      readSheet<VentaDia>('Ventas'),
      readSheet<StockCamara>('StockCamara').catch(() => []),
    ]);
  } catch {}

  // Datos del panel
  let cosechadoMes = 0, cosechadoMesPasado = 0, diaCorte = new Date().getDate();
  let navesOcup: any[] = [], tubosMesadas: any[] = [];
  let resumen = { lechuga: { plantinera:0,fase_1:0,fase_2:0,total:0 }, rucula: { plantinera:0,fase_1:0,fase_2:0,total:0 }, albahaca: { plantinera:0,fase_1:0,fase_2:0,total:0 } };
  let ciclosLechuga = { barras: [] as any[], semanasCosecha: 5 };
  let ciclosRucula  = { barras: [] as any[], semanasCosecha: 3 };
  let resumenCosecha: any[] = [];
  let ciclosSemanas: any[] = [];
  let ciclosRealesMap = new Map<string,number>();

  const camaraRucula  = calcularCamara('rucula',  registrosCamara, lotes, ventasPanel);
  const camaraLechuga = calcularCamara('lechuga', registrosCamara, lotes, ventasPanel);

  try {
    const mes = cosechadoEsteMes(lotes);
    cosechadoMes = mes.actual; cosechadoMesPasado = mes.pasado; diaCorte = mes.diaCorte;
    navesOcup     = ocupacionPorNave(ubicaciones, lotes);
    tubosMesadas  = tubosPorMesada(ubicaciones, lotes);
    resumen       = plantasPorCultivo(lotes);
    ciclosLechuga = distribucionPorSemana(lotes, variedades, 'lechuga');
    ciclosRucula  = distribucionPorSemana(lotes, variedades, 'rucula');
    resumenCosecha = resumenCosechaPorCultivo(lotes, variedades);
    ciclosSemanas  = ciclosPorSemana(lotes, movimientos);
    ciclosRealesMap = cicloRealPorVariedad(lotes, [], 5);
  } catch {}

  const ocGlobal = navesOcup.length > 0
    ? Math.round(navesOcup.reduce((a:number,n:any)=>a+n.tubos_ocupados,0) /
      Math.max(1, navesOcup.reduce((a:number,n:any)=>a+n.tubos_totales,0)) * 100)
    : 0;
  const difPct = cosechadoMesPasado > 0 ? Math.round(((cosechadoMes-cosechadoMesPasado)/cosechadoMesPasado)*100) : 0;

  // ── ALERTAS ──
  const hoy = new Date();
  const alertas: { tipo: 'error'|'warn'|'info'; msg: string; lote?: string; prioridad?: number }[] = [];

  // Promedio F1 por variedad (para detectar lotes lentos en F1)
  const promedioF1Map = new Map<string,number>();
  const cosechadosConF1 = lotes.filter(l => l.estado==='cosechado' && Number(l.dias_f1) > 0);
  for (const vNorm of ['lechuga','rucula']) {
    const grupo = cosechadosConF1.filter(l => {
      const v = String(l.variedad||'').toLowerCase();
      return vNorm==='rucula' ? v.includes('rucula')||v.includes('rúcula') : !v.includes('rucula')&&!v.includes('rúcula');
    });
    if (grupo.length > 0) {
      const prom = Math.round(grupo.reduce((a,l)=>a+Number(l.dias_f1),0)/grupo.length);
      promedioF1Map.set(vNorm, prom);
    }
  }

  for (const l of lotes.filter(l => l.estado==='activo')) {
    const diasSiembra = (() => { const f = safeDate(l.fecha_siembra); return f ? Math.round((hoy.getTime()-f.getTime())/86400000) : 0; })();
    const diasF2 = (() => { const f = safeDate(l.fecha_f2); return f ? Math.round((hoy.getTime()-f.getTime())/86400000) : 0; })();
    const diasF1 = (() => { const f = safeDate(l.fecha_f1); return f && l.fase_actual==='fase_1' ? Math.round((hoy.getTime()-f.getTime())/86400000) : 0; })();
    const varNorm = String(l.variedad||'').toLowerCase();
    const esR = varNorm.includes('rucula') || varNorm.includes('rúcula');
    const cicloEst = ciclosRealesMap.get(l.variedad) || (esR ? 35 : 80);
    const f2Est = esR ? 28 : 40; // días esperados en F2

    // 🔴 Cosecha inminente (F2 próximos 3 días)
    if (l.fase_actual === 'fase_2' && l.fecha_f2) {
      const diasRestantes = cicloEst - diasSiembra;
      if (diasRestantes >= 0 && diasRestantes <= 3) {
        alertas.push({ tipo:'error', msg:`🌿 Cosechar en ~${diasRestantes}d — ${l.id_lote} (${String(l.variedad||'').split(' ')[0]})`, lote: l.id_lote });
      }
    }

    // 🔴 Lote pasado en F2 (> ciclo * 130%)
    if (diasSiembra > cicloEst * 1.3 && l.fase_actual === 'fase_2') {
      alertas.push({ tipo:'error', msg:`Lote ${l.id_lote} lleva ${diasSiembra}d de ${cicloEst}d est. — vencido`, lote: l.id_lote });
    }

    // 🔴 F2 muy extendida (> f2Est * 130%)
    if (l.fase_actual === 'fase_2' && diasF2 > f2Est * 1.3) {
      alertas.push({ tipo:'error', msg:`${l.id_lote} lleva ${diasF2}d en F2 (est. ${f2Est}d) — revisar`, lote: l.id_lote });
    }

    // 🟡 F1 muy extendida
    const promF1 = promedioF1Map.get(esR?'rucula':'lechuga') || (esR ? 10 : 20);
    if (l.fase_actual === 'fase_1' && diasF1 > promF1 * 1.5 && diasF1 > 15) {
      alertas.push({ tipo:'warn', msg:`${l.id_lote} lleva ${diasF1}d en F1 (prom ${promF1}d) — demorado`, lote: l.id_lote });
    }

    // 🟡 Lote en plantinera > 30 días
    if (l.fase_actual === 'plantin' && diasSiembra > 30) {
      alertas.push({ tipo:'warn', msg:`${l.id_lote} lleva ${diasSiembra}d en plantinera — trasplantar`, lote: l.id_lote });
    }
  }

  // 🟡 Sin siembras en últimos 7 días
  const hace7 = new Date(hoy); hace7.setDate(hoy.getDate()-7);
  const siembrasRecientes = lotes.filter(l => { const f = safeDate(l.fecha_siembra); return f && f >= hace7; });
  if (siembrasRecientes.length === 0) {
    alertas.push({ tipo:'warn', msg:'Sin siembras en los últimos 7 días — posible gap de producción' });
  }

  // 🟡 Ocupación total > 95%
  if (ocGlobal > 95) {
    alertas.push({ tipo:'warn', msg:`Ocupación global al ${ocGlobal}% — sin espacio para nuevos trasplantes` });
  }

  // 🔵 Mesadas F2 con capacidad > 50% libre (oportunidad)
  for (const nave of tubosMesadas) {
    for (const m of nave.mesadas || []) {
      if (m.sector_fase === 'fase_2' && m.tubos_totales > 10 && m.tubos_libres > m.tubos_totales * 0.5) {
        alertas.push({ tipo:'info', msg:`${m.nombre.replace(/^Nave \d+ - /,'')} F2 al ${m.ocupacion_pct}% — espacio disponible` });
      }
    }
  }

  // 🔵 Sub-ocupación de mesadas F1 (< 40%)
  for (const nave of tubosMesadas) {
    for (const m of nave.mesadas || []) {
      if (m.sector_fase === 'fase_1' && m.tubos_totales > 10 && m.ocupacion_pct < 40 && m.ocupacion_pct > 0) {
        alertas.push({ tipo:'warn', msg:`${m.nombre.replace(/^Nave \d+ - /,'')} F1 al ${m.ocupacion_pct}% — sub-ocupada` });
      }
    }
  }

  // 🔵 Mesadas vacías (prioridad 0 — van primero)
  for (const nave of tubosMesadas) {
    for (const m of nave.mesadas || []) {
      if (m.tubos_totales > 10 && m.tubos_ocupados === 0) {
        alertas.push({ tipo:'info', msg:`${m.nombre.replace(/^Nave \d+ - /,'')} — vacía`, prioridad: 0 });
      }
    }
  }

  // Ordenar: vacías primero, luego errores, warn, info
  alertas.sort((a,b) => {
    const pa = a.prioridad ?? ({ error:1, warn:2, info:3 } as any)[a.tipo];
    const pb = b.prioridad ?? ({ error:1, warn:2, info:3 } as any)[b.tipo];
    return pa - pb;
  });

  // ── ÚLTIMOS MOVIMIENTOS (últimos 8) ──
  const lotesMap = new Map(lotes.map(l => [l.id_lote, l]));
  const ultimosMovs = [...movimientos]
    .filter(m => m.fecha)
    .sort((a,b) => String(b.fecha||'').localeCompare(String(a.fecha||'')))
    .slice(0, 8);

  // ── KPIs F2 ──
  const ultSem = ciclosSemanas.filter((s:any) => s.lechugaF2>0||s.rucula>0).slice(-1)[0];
  const antSem = ciclosSemanas.filter((s:any) => s.lechugaF2>0||s.rucula>0).slice(-2,-1)[0];
  function varPctSem(a:number,b:number){if(!b||!a)return null;return Math.round(((a-b)/b)*100);}

  const rL = resumenCosecha.find((r:any) => r.cultivo==='lechuga');
  const rR = resumenCosecha.find((r:any) => r.cultivo==='rucula');

  // ── LOTES FILTRADOS CON PAGINACIÓN ──
  const conteos = contarPorFiltro(lotes, nave);
  const lotesFiltrados = query
    ? lotes.filter(l => String(l.id_lote||'').toLowerCase().includes(query))
    : aplicarFiltros3(lotes, cultivo, fase, nave, mesada, tiempo);
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

        {/* ══ FILA 1: ALERTAS + PROYECCIONES ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', marginBottom:'14px' }}>

          {/* Alertas */}
          <div style={{ background:'white', border:'1px solid #e5e7eb', borderTop:'4px solid #f59e0b', borderRadius:'10px', padding:'14px', gridColumn: alertas.length === 0 ? '1' : '1' }}>
            <p style={{ margin:'0 0 8px', fontSize:'11px', fontWeight:700, color:'#92400e', textTransform:'uppercase' }}>⚠ Alertas</p>
            {alertas.length === 0 ? (
              <p style={{ color:'#059669', fontSize:'12px', fontWeight:600 }}>✓ Sin alertas activas</p>
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
              Ocup. global: <strong>{ocGlobal}%</strong>
              {navesOcup.map((n:any) => <span key={n.nave}> · N{n.nave}: <strong>{n.ocupacion_pct}%</strong></span>)}
            </div>
          </div>

          {/* ── helper para card de proyección ── */}
          {[
            { r: rL, label: 'LECHUGA', colorTop: '#4d7c0f', colorF2: '#4d7c0f', bgStock: '#f0fdf4',
              subtitulo: null, unidad: 'pl est.',
              boxes: rL ? [['Cosechado',rL.cosechadoMes,'#4d7c0f','#f7fee7'],['Prox 7d',rL.proyectadoEstaSemana,'#854d0e','#fefce8'],['Resto mes',rL.proyectadoRestoMes,'#059669','#f0fdf4']] : [],
              totalProyectado: rL ? rL.cosechadoMes+rL.proyectadoMesTotal : 0,
              varPct: rL?.variacionPct ?? null,
              infoLine: rL ? `F1: ${resumen.lechuga.fase_1.toLocaleString('es-AR')} · F2: ${resumen.lechuga.fase_2.toLocaleString('es-AR')}` : '',
              camara: camaraLechuga,
            },
            { r: rR, label: 'RÚCULA', colorTop: '#166534', colorF2: '#166534', bgStock: '#dcfce7',
              subtitulo: rR ? `~${((rR.cosechadoMes+rR.proyectadoMesTotal)*rR.plantasPorPaquete).toLocaleString('es-AR')} plantas` : null,
              unidad: 'paq. est.',
              boxes: rR ? [['Cosechado',rR.cosechadoMes,'#166534','#dcfce7'],['Prox 7d',rR.proyectadoEstaSemana,'#854d0e','#fefce8'],['Resto mes',rR.proyectadoRestoMes,'#059669','#f0fdf4']] : [],
              totalProyectado: rR ? rR.cosechadoMes+rR.proyectadoMesTotal : 0,
              varPct: rR?.variacionPct ?? null,
              infoLine: rR ? `Plant.: ${resumen.rucula.plantinera.toLocaleString('es-AR')} · F2: ${Math.round(resumen.rucula.fase_2/3).toLocaleString('es-AR')} paq.` : '',
              camara: camaraRucula,
            },
          ].map(({ r, label, colorTop, bgStock, subtitulo, unidad, boxes, totalProyectado, varPct, infoLine, camara }) => r && (
            <div key={label} style={{ background:'white', border:'1px solid #e5e7eb', borderTop:`4px solid ${colorTop}`, borderRadius:'10px', padding:'14px', display:'flex', flexDirection:'column' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                <span style={{ background:colorTop, color:'white', padding:'1px 8px', borderRadius:'4px', fontSize:'11px', fontWeight:800 }}>{label}</span>
                <span style={{ fontSize:'10px', color:'#9ca3af' }}>Proyección mes</span>
              </div>
              <div style={{ display:'flex', alignItems:'baseline', gap:'6px', marginBottom:'2px' }}>
                <span style={{ fontSize:'28px', fontWeight:800, color:'#14532d', lineHeight:1 }}>{totalProyectado.toLocaleString('es-AR')}</span>
                <span style={{ fontSize:'11px', color:'#6b7280' }}>{unidad}</span>
              </div>
              {/* Subtítulo: plantas para rúcula, espacio fijo para lechuga */}
              <p style={{ margin:'0 0 3px', fontSize:'10px', color:'#9ca3af', minHeight:'14px' }}>{subtitulo || ''}</p>
              {varPct !== null ? (
                <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'8px' }}>
                  <span style={{ fontSize:'16px', fontWeight:800, color:varPct>=0?'#059669':'#dc2626', background:varPct>=0?'#f0fdf4':'#fef2f2', borderRadius:'5px', padding:'1px 7px' }}>
                    {varPct>=0?'↑':'↓'} {Math.abs(varPct)}%
                  </span>
                  <span style={{ fontSize:'10px', color:'#9ca3af' }}>vs mayo</span>
                </div>
              ) : <p style={{ fontSize:'10px', color:'#9ca3af', marginBottom:'8px' }}>Sin datos mayo</p>}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'4px' }}>
                {(boxes as any[]).map(([l,v,c,b]:any) => (
                  <div key={l} style={{ background:v>0?b:'#f9fafb', borderRadius:'5px', padding:'5px', textAlign:'center' }}>
                    <p style={{ margin:'0 0 1px', fontSize:'8px', color:v>0?c:'#9ca3af', fontWeight:700, textTransform:'uppercase' }}>{l}</p>
                    <p style={{ margin:0, fontSize:'13px', fontWeight:700, color:v>0?'#111827':'#d1d5db' }}>{v>0?v.toLocaleString('es-AR'):'—'}</p>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:'7px', fontSize:'10px', color:'#6b7280' }}>{infoLine}</div>
              {camara.stockActual > 0 && (() => {
                const dc = camara.diasPromedio;
                const cc = dc > 7 ? '#dc2626' : dc > 4 ? '#d97706' : '#059669';
                const bc = dc > 7 ? '#fef2f2' : dc > 4 ? '#fffbeb' : '#f0fdf4';
                return (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px', marginTop:'7px', paddingTop:'7px', borderTop:'1px solid #f3f4f6' }}>
                    <div style={{ background:bgStock, borderRadius:'5px', padding:'5px', textAlign:'center' }}>
                      <p style={{ margin:'0 0 1px', fontSize:'8px', color:colorTop, fontWeight:700, textTransform:'uppercase' }}>Stock cámara</p>
                      <p style={{ margin:0, fontSize:'13px', fontWeight:700, color:'#111827' }}>{camara.stockActual.toLocaleString('es-AR')} paq.</p>
                    </div>
                    <div style={{ background:bc, borderRadius:'5px', padding:'5px', textAlign:'center' }}>
                      <p style={{ margin:'0 0 1px', fontSize:'8px', color:cc, fontWeight:700, textTransform:'uppercase' }}>Días en cámara</p>
                      <p style={{ margin:0, fontSize:'13px', fontWeight:700, color:cc }}>{dc}d {dc > 7 ? '🔴' : dc > 4 ? '🟡' : '🟢'}</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>

        {/* ══ FILA 2: CICLOS + ÚLTIMOS MOVIMIENTOS ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'14px' }}>
          <div className="card" style={{ margin:0 }}>
            <p className="card-title">Ciclos en mesadas — 8 semanas</p>
            <p className="card-sub">Días promedio F2 por semana · sin plantinera</p>
            <GraficoCiclosSemanas datos={ciclosSemanas} />
            {ultSem && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginTop:'10px', paddingTop:'10px', borderTop:'1px solid #f3f4f6' }}>
                {ultSem.lechugaF2>0 && (
                  <div style={{ textAlign:'center', padding:'8px', background:'#f7fee7', borderRadius:'7px' }}>
                    <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#4d7c0f', fontWeight:700 }}>Lechuga F2</p>
                    <p style={{ margin:'0 0 1px', fontSize:'22px', fontWeight:800, color:'#14532d' }}>{ultSem.lechugaF2}d</p>
                    {varPctSem(ultSem.lechugaF2, antSem?.lechugaF2) !== null && (
                      <p style={{ margin:0, fontSize:'10px', fontWeight:600, color:varPctSem(ultSem.lechugaF2,antSem?.lechugaF2)!<=0?'#059669':'#dc2626' }}>
                        {varPctSem(ultSem.lechugaF2,antSem?.lechugaF2)!<=0?'↓':'↑'} {Math.abs(varPctSem(ultSem.lechugaF2,antSem?.lechugaF2)!)}%
                      </p>
                    )}
                  </div>
                )}
                {ultSem.rucula>0 && (
                  <div style={{ textAlign:'center', padding:'8px', background:'#f0fdf4', borderRadius:'7px' }}>
                    <p style={{ margin:'0 0 1px', fontSize:'10px', color:'#166534', fontWeight:700 }}>Rúcula F2</p>
                    <p style={{ margin:'0 0 1px', fontSize:'22px', fontWeight:800, color:'#14532d' }}>{ultSem.rucula}d</p>
                    {varPctSem(ultSem.rucula, antSem?.rucula) !== null && (
                      <p style={{ margin:0, fontSize:'10px', fontWeight:600, color:varPctSem(ultSem.rucula,antSem?.rucula)!<=0?'#059669':'#dc2626' }}>
                        {varPctSem(ultSem.rucula,antSem?.rucula)!<=0?'↓':'↑'} {Math.abs(varPctSem(ultSem.rucula,antSem?.rucula)!)}%
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Últimos movimientos */}
          <div className="card" style={{ margin:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
              <p className="card-title" style={{ margin:0 }}>Últimos movimientos</p>
              <Link href="/movimientos" style={{ fontSize:'11px', color:'#6b7280', textDecoration:'none' }}>Ver todos →</Link>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
              {ultimosMovs.length === 0
                ? <p style={{ color:'#9ca3af', fontSize:'12px', textAlign:'center', padding:'20px' }}>Sin movimientos</p>
                : ultimosMovs.map(m => {
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
                  })}
            </div>
          </div>
        </div>

        {/* ══ FILA 3: DISTRIBUCIÓN EN MESADAS ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'14px' }}>
          <div style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px' }}>
            <p style={{ margin:'0 0 3px', fontSize:'11px', color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.3px' }}>Distribución en mesadas</p>
            <p style={{ margin:'0 0 10px', fontSize:'10px', color:'#9ca3af' }}>Semana de ciclo · F1 y F2</p>
            <GraficoCiclos titulo="Lechuga" color="#4d7c0f" colorF1="#86efac" colorF2="#16a34a"
              barras={ciclosLechuga.barras} semanasCosecha={ciclosLechuga.semanasCosecha} semanaActual={0} />
          </div>
          <div style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px' }}>
            <p style={{ margin:'0 0 3px', fontSize:'11px', color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.3px' }}>Distribución en mesadas</p>
            <p style={{ margin:'0 0 10px', fontSize:'10px', color:'#9ca3af' }}>Semana de ciclo · F2</p>
            <GraficoCiclos titulo="Rúcula" color="#166534" colorF1="#6ee7b7" colorF2="#047857"
              barras={ciclosRucula.barras} semanasCosecha={ciclosRucula.semanasCosecha} semanaActual={0} sinF1 />
          </div>
        </div>

        {/* ══ FILA 4: OCUPACIÓN POR MESADA ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'14px' }}>
          {tubosMesadas.map((nave: any) => (
            <div key={nave.nave} style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'12px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                <span style={{ background:nave.nave===1?'#881337':'#7c3aed', color:'white', padding:'2px 10px', borderRadius:'5px', fontSize:'12px', fontWeight:700 }}>NAVE {nave.nave}</span>
                <span style={{ fontSize:'11px', color:'#6b7280' }}>{nave.tubos_ocupados}/{nave.tubos_totales} · <strong>{nave.ocupacion_pct}%</strong></span>
              </div>
              <div style={{ height:'4px', background:'#f3f4f6', borderRadius:'2px', overflow:'hidden', marginBottom:'8px' }}>
                <div style={{ width:Math.min(100,nave.ocupacion_pct)+'%', height:'100%', background:nave.nave===1?'#881337':'#7c3aed' }} />
              </div>
              <table style={{ fontSize:'11px' }}>
                <thead><tr>
                  <th style={{ textAlign:'left', padding:'3px 6px' }}>Mesada</th>
                  <th style={{ textAlign:'center', width:'26px' }}>F</th>
                  <th style={{ textAlign:'right' }}>Tot.</th>
                  <th style={{ textAlign:'right' }}>Ocup.</th>
                  <th style={{ textAlign:'right' }}>Lib.</th>
                  <th style={{ textAlign:'right' }}>%</th>
                </tr></thead>
                <tbody>
                  {(nave.mesadas||[]).map((m: any) => (
                    <tr key={m.id_ubicacion}>
                      <td style={{ padding:'3px 6px', fontWeight:500 }}>{m.nombre.replace(/^Nave \d+ - /,'').replace(' (F1)','').replace(' (F2)','')}</td>
                      <td style={{ textAlign:'center' }}>
                        <span style={{ background:m.sector_fase==='fase_1'?'#dbeafe':'#dcfce7', color:m.sector_fase==='fase_1'?'#1e40af':'#166534', padding:'1px 4px', borderRadius:'3px', fontSize:'9px', fontWeight:600 }}>
                          {m.sector_fase==='fase_1'?'F1':'F2'}
                        </span>
                      </td>
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
            <Link href="/estadisticas" className="btn secondary">Estadísticas</Link>
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
