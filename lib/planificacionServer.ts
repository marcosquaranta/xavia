import type { Lote, Movimiento, Ubicacion } from './types';
import { diasPromedioPorVariedad } from './estadisticas';
import { calcularDiasPorFase } from './lotes';
import type { Cap, NavesCap, Dias } from './planificacion';

const esRuculaVar = (v: string) => { const x = String(v).toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };
const mesadaCorta = (s: string) => String(s || '').replace(/^Nave\s*\d+\s*-\s*/i, '').trim();
const naveDeUbic = (u: string) => /nave\s*2/i.test(String(u)) ? 2 : 1;
const normVar = (v: any) => String(v || '').trim().toLowerCase();

// Promedio real por variedad: prioriza los últimos 120 días (más representativo del
// ritmo actual); si esa variedad no se cosechó en ese lapso, busca en TODO el
// historial disponible antes de recurrir a un default genérico por cultivo. El
// matching se normaliza (trim + minúsculas) para no perder datos por espacios o
// mayúsculas distintas entre el catálogo de variedades y los lotes.
function estimadorPorVariedad(lotes: Lote[], movimientos: Movimiento[]) {
  const reciente = new Map(diasPromedioPorVariedad(lotes, movimientos, 120).map(d => [normVar(d.variedad), d]));
  const historico = new Map(diasPromedioPorVariedad(lotes, movimientos, 3650).map(d => [normVar(d.variedad), d]));
  return (variedad: string) => reciente.get(normVar(variedad)) || historico.get(normVar(variedad)) || null;
}

export interface ItemLote { id: string; dias: number; est: number }
export interface GrupoLotes { nave: number; mesada: string; titulo: string; items: ItemLote[] }

function ordenarGrupos(grupos: Map<string, GrupoLotes>): GrupoLotes[] {
  const arr = Array.from(grupos.values());
  for (const g of arr) g.items.sort((x, y) => (y.dias - y.est) - (x.dias - x.est));
  arr.sort((a, b) => {
    const peorA = a.items[0] ? a.items[0].dias - a.items[0].est : 0;
    const peorB = b.items[0] ? b.items[0].dias - b.items[0].est : 0;
    if (peorA !== peorB) return peorB - peorA;
    return a.nave - b.nave || a.mesada.localeCompare(b.mesada);
  });
  return arr;
}

// ── Trasplantes reales pendientes: lotes activos que ya cumplieron (o pasaron) su fase ──
// Agrupados por nave + mesada + transición (plantinera→F1, F1→F2), con los días que
// lleva cada lote en su fase actual para poder marcar los más atrasados.
export function trasplantesAgrupados(lotes: Lote[], movimientos: Movimiento[]): GrupoLotes[] {
  const estimador = estimadorPorVariedad(lotes, movimientos);
  const activos = lotes.filter(l => l.estado === 'activo');
  const grupos = new Map<string, GrupoLotes>();
  for (const l of activos) {
    let dias: any;
    try { dias = calcularDiasPorFase(l, movimientos); } catch { continue; }
    const est = estimador(l.variedad);
    let de = '', a = '', diasEnFase = 0, estFase = 0;
    if (l.fase_actual === 'plantin') {
      // Default cultivo-aware (rúcula suele estar menos días en plantinera que lechuga)
      // — evita falsos "listos" cuando no hay promedio real para esa variedad.
      estFase = est?.plantinera || (esRuculaVar(l.variedad) ? 8 : 15);
      diasEnFase = dias.plantinera; de = 'Plantinera'; a = 'Fase 1';
    } else if (l.fase_actual === 'fase_1') {
      estFase = est?.fase_1 || 22; diasEnFase = dias.fase_1 || 0; de = 'Fase 1'; a = 'Fase 2';
    } else continue;
    if (diasEnFase < estFase) continue; // todavía no llegó a la fecha estimada
    const nave = naveDeUbic(l.ubicacion_actual);
    const mesada = mesadaCorta(l.ubicacion_actual) || '(sin mesada)';
    const titulo = `${de} → ${a}`;
    const key = `${nave}|${mesada}|${titulo}`;
    if (!grupos.has(key)) grupos.set(key, { nave, mesada, titulo, items: [] });
    grupos.get(key)!.items.push({ id: l.id_lote, dias: diasEnFase, est: estFase });
  }
  return ordenarGrupos(grupos);
}

// Días en Fase 2 del ÚLTIMO lote cosechado de cada cultivo (rúcula/lechuga) — la
// referencia real contra la que se compara si un lote activo ya está a tiempo de
// cosecharse. Null si nunca se cosechó ese cultivo (no hay con qué comparar).
function ultimoF2PorCultivo(lotes: Lote[], movimientos: Movimiento[]): { rucula: number | null; lechuga: number | null } {
  const cosechados = lotes
    .filter(l => l.estado === 'cosechado' && l.fecha_cosecha)
    .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')));
  const f2DelUltimo = (esRucula: boolean) => {
    const l = cosechados.find(l => esRuculaVar(l.variedad) === esRucula);
    if (!l) return null;
    try { const d = calcularDiasPorFase(l, movimientos); return d.fase_2 > 0 ? d.fase_2 : null; } catch { return null; }
  };
  return { rucula: f2DelUltimo(true), lechuga: f2DelUltimo(false) };
}

// ── Cosechas reales pendientes: lotes en Fase 2 cuyos días EN FASE 2 ya alcanzan o
// superan los días en Fase 2 del último lote cosechado de ese mismo cultivo. Agrupados
// por nave + mesada. Si no hay un lote cosechado de referencia para ese cultivo, no
// se muestra nada (no hay con qué comparar). ──
export function cosechasAgrupadas(lotes: Lote[], movimientos: Movimiento[]): GrupoLotes[] {
  const ref = ultimoF2PorCultivo(lotes, movimientos);
  const activos = lotes.filter(l => l.estado === 'activo' && l.fase_actual === 'fase_2');
  const grupos = new Map<string, GrupoLotes>();
  for (const l of activos) {
    let dias: any;
    try { dias = calcularDiasPorFase(l, movimientos); } catch { continue; }
    const refF2 = esRuculaVar(l.variedad) ? ref.rucula : ref.lechuga;
    if (refF2 === null) continue; // sin referencia real para este cultivo
    const diasF2 = dias.fase_2 || 0;
    if (diasF2 < refF2) continue; // todavía no llegó a los días de F2 del último cosechado
    const nave = naveDeUbic(l.ubicacion_actual);
    const mesada = mesadaCorta(l.ubicacion_actual) || '(sin mesada)';
    const key = `${nave}|${mesada}`;
    if (!grupos.has(key)) grupos.set(key, { nave, mesada, titulo: 'Lista para cosechar', items: [] });
    grupos.get(key)!.items.push({ id: l.id_lote, dias: diasF2, est: refF2 });
  }
  return ordenarGrupos(grupos);
}

// ── Capacidad por nave desde Ubicaciones ──
export function calcularCapacidad(ubicaciones: Ubicacion[]): NavesCap {
  const mesadas = ubicaciones.filter(u => u.tipo === 'mesada' && u.activo === 'SI');
  const perf = (m: Ubicacion) => (Number(m.modulos) || 1) * (Number(m.perfiles_por_modulo) || 0);
  const pos = (m: Ubicacion) => perf(m) * (Number(m.orificios_por_perfil) || 0);
  const cap = (nave: number): Cap => {
    const enNave = mesadas.filter(m => Number(m.nave) === nave);
    const ruc = enNave.filter(m => m.variedad_asignada === 'rucula' || m.variedad_asignada === 'mixta');
    const lecF2 = enNave.filter(m => m.variedad_asignada === 'lechuga' && m.sector_fase === 'fase_2');
    const lecF1 = enNave.filter(m => m.variedad_asignada === 'lechuga' && m.sector_fase === 'fase_1');
    const rucPerfTot = ruc.reduce((a, m) => a + perf(m), 0);
    const rucPos = ruc.reduce((a, m) => a + pos(m), 0);
    const lecF2PerfTot = lecF2.reduce((a, m) => a + perf(m), 0);
    const lecF2Pos = lecF2.reduce((a, m) => a + pos(m), 0);
    const lecF1PerfTot = lecF1.reduce((a, m) => a + perf(m), 0);
    const lecF1Pos = lecF1.reduce((a, m) => a + pos(m), 0);
    return {
      ruc: rucPos, rucPerfTot, rucPosPerf: rucPerfTot ? Math.round((rucPos / rucPerfTot) * 10) / 10 : 22,
      lecF2PerfTot, lecPosPerf: lecF2PerfTot ? Math.round(lecF2Pos / lecF2PerfTot) : 13,
      lecF1PerfTot, lecF1PosPerf: lecF1PerfTot ? Math.round(lecF1Pos / lecF1PerfTot) : 40,
    };
  };
  return { 1: cap(1), 2: cap(2) };
}

function fmtFechaCorta(f: any): string {
  const s = String(f || '').split(/[T ]/)[0];
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
}

// ── Días de ciclo default = del ÚLTIMO lote cosechado de cada cultivo (no un promedio) ──
// Así refleja el ciclo real más reciente. Sigue siendo editable en la UI para simular.
export function diasCicloDefault(lotes: Lote[], movimientos: Movimiento[]): Dias {
  const cosechados = lotes
    .filter(l => l.estado === 'cosechado' && l.fecha_cosecha)
    .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')));
  const ultimoRucula = cosechados.find(l => esRuculaVar(l.variedad));
  const ultimoLechuga = cosechados.find(l => !esRuculaVar(l.variedad));
  const dR = ultimoRucula ? calcularDiasPorFase(ultimoRucula, movimientos) : null;
  const dL = ultimoLechuga ? calcularDiasPorFase(ultimoLechuga, movimientos) : null;

  return {
    rucDias: (dR?.fase_2 || dR?.total) || 32,
    lecF2Dias: dL?.fase_2 || 35,
    lecF1Dias: dL?.fase_1 || 25,
    rucFuente: ultimoRucula ? `último lote ${ultimoRucula.id_lote} · cosechado ${fmtFechaCorta(ultimoRucula.fecha_cosecha)}` : 'sin cosechas registradas, valor por defecto',
    lecFuente: ultimoLechuga ? `último lote ${ultimoLechuga.id_lote} · cosechado ${fmtFechaCorta(ultimoLechuga.fecha_cosecha)}` : 'sin cosechas registradas, valor por defecto',
  };
}
