import type { Lote, Movimiento, Ubicacion } from './types';
import { diasPromedioPorVariedad } from './estadisticas';
import { calcularDiasPorFase } from './lotes';
import { POSPAQ, type Cap, type NavesCap, type Dias } from './planificacion';

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
export interface GrupoLotes { nave: number; mesada: string; cultivo: 'rucula' | 'lechuga'; titulo: string; items: ItemLote[] }

function ordenarGrupos(grupos: Map<string, GrupoLotes>): GrupoLotes[] {
  const arr = Array.from(grupos.values());
  for (const g of arr) g.items.sort((x, y) => (y.dias - y.est) - (x.dias - x.est));
  // Nave primero, después cultivo, después mesada — para que sea fácil de recorrer
  // (en vez de saltar de nave en nave según cuál está "peor").
  arr.sort((a, b) => a.nave - b.nave || a.cultivo.localeCompare(b.cultivo) || a.mesada.localeCompare(b.mesada));
  return arr;
}

// ── Trasplantes reales pendientes: lotes activos que ya cumplieron (o pasaron) su fase ──
// Agrupados por nave + mesada + CULTIVO + transición (plantinera→F1, F1→F2), con los
// días que lleva cada lote en su fase actual para poder marcar los más atrasados.
// El cultivo es parte de la clave porque "Plantinera" es un mismo espacio físico
// compartido por rúcula y lechuga (mismo nombre de mesada) — sin distinguir cultivo,
// se mezclan lotes con umbrales de días muy distintos bajo un mismo grupo.
export function trasplantesAgrupados(lotes: Lote[], movimientos: Movimiento[]): GrupoLotes[] {
  const estimador = estimadorPorVariedad(lotes, movimientos);
  const activos = lotes.filter(l => l.estado === 'activo');
  const grupos = new Map<string, GrupoLotes>();
  for (const l of activos) {
    let dias: any;
    try { dias = calcularDiasPorFase(l, movimientos); } catch { continue; }
    const esRucula = esRuculaVar(l.variedad);
    const est = estimador(l.variedad);
    let de = '', a = '', diasEnFase = 0, estFase = 0;
    if (l.fase_actual === 'plantin') {
      // Default cultivo-aware (rúcula suele estar menos días en plantinera que lechuga)
      // — evita falsos "listos" cuando no hay promedio real para esa variedad.
      estFase = est?.plantinera || (esRucula ? 8 : 15);
      diasEnFase = dias.plantinera; de = 'Plantinera'; a = 'Fase 1';
    } else if (l.fase_actual === 'fase_1') {
      estFase = est?.fase_1 || 22; diasEnFase = dias.fase_1 || 0; de = 'Fase 1'; a = 'Fase 2';
    } else continue;
    if (diasEnFase < estFase) continue; // todavía no llegó a la fecha estimada
    const nave = naveDeUbic(l.ubicacion_actual);
    const mesada = mesadaCorta(l.ubicacion_actual) || '(sin mesada)';
    const cultivo: 'rucula' | 'lechuga' = esRucula ? 'rucula' : 'lechuga';
    const titulo = `${de} → ${a}`;
    const key = `${nave}|${mesada}|${cultivo}|${titulo}`;
    if (!grupos.has(key)) grupos.set(key, { nave, mesada, cultivo, titulo, items: [] });
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
    const esRucula = esRuculaVar(l.variedad);
    const refF2 = esRucula ? ref.rucula : ref.lechuga;
    if (refF2 === null) continue; // sin referencia real para este cultivo
    const diasF2 = dias.fase_2 || 0;
    if (diasF2 < refF2) continue; // todavía no llegó a los días de F2 del último cosechado
    const nave = naveDeUbic(l.ubicacion_actual);
    const mesada = mesadaCorta(l.ubicacion_actual) || '(sin mesada)';
    const cultivo: 'rucula' | 'lechuga' = esRucula ? 'rucula' : 'lechuga';
    const key = `${nave}|${mesada}|${cultivo}`;
    if (!grupos.has(key)) grupos.set(key, { nave, mesada, cultivo, titulo: 'Lista para cosechar', items: [] });
    grupos.get(key)!.items.push({ id: l.id_lote, dias: diasF2, est: refF2 });
  }
  return ordenarGrupos(grupos);
}

// ── Estimación de cosecha que posiblemente caiga HOY o MAÑANA (para Ventas: "cuánto
// puedo llegar a tener para vender"). Mismo criterio de referencia que cosechasAgrupadas
// (F2 del último lote cosechado de esa variedad), pero con un día de margen hacia
// adelante. En unidades de venta: rúcula en paquetes (÷3, 3 posiciones/paquete),
// lechuga en plantas — sin conversión, ya que 1 planta = 1 unidad de venta.
// Lechuga separada en crespa/roble (roble = catch-all de cualquier lechuga no-crespa,
// mismo criterio que lib/camara.ts) — antes iba junta, pero tienen precio y demanda
// distintos y hace falta saber cuánta hay de cada una. ──
const esCrespaVar = (v: string) => String(v).toLowerCase().includes('crespa');

export interface EstimacionCosechaCercana { rucula: number; lechuga_crespa: number; lechuga_roble: number }
export function estimacionCosechaHoyManana(lotes: Lote[], movimientos: Movimiento[]): EstimacionCosechaCercana {
  const cosechados = lotes
    .filter(l => l.estado === 'cosechado' && l.fecha_cosecha)
    .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')));
  function refF2(match: (v: string) => boolean): number | null {
    const l = cosechados.find(l => match(l.variedad));
    if (!l) return null;
    try { const d = calcularDiasPorFase(l, movimientos); return d.fase_2 > 0 ? d.fase_2 : null; } catch { return null; }
  }
  const refRucula = refF2(esRuculaVar);
  const refCrespa = refF2((v) => !esRuculaVar(v) && esCrespaVar(v));
  const refRoble = refF2((v) => !esRuculaVar(v) && !esCrespaVar(v));

  const activos = lotes.filter(l => l.estado === 'activo' && l.fase_actual === 'fase_2');
  let ruculaPlantas = 0, crespaPlantas = 0, roblePlantas = 0;
  for (const l of activos) {
    let dias: any;
    try { dias = calcularDiasPorFase(l, movimientos); } catch { continue; }
    const esRucula = esRuculaVar(l.variedad);
    const esCrespa = !esRucula && esCrespaVar(l.variedad);
    const refF2Usado = esRucula ? refRucula : esCrespa ? refCrespa : refRoble;
    if (refF2Usado === null) continue;
    const diasF2 = dias.fase_2 || 0;
    if (refF2Usado - diasF2 > 1) continue; // falta más de 1 día para el punto de cosecha esperado
    const plantas = Number(l.plantas_estimadas_actual) || 0;
    if (esRucula) ruculaPlantas += plantas;
    else if (esCrespa) crespaPlantas += plantas;
    else roblePlantas += plantas;
  }
  return { rucula: Math.round(ruculaPlantas / POSPAQ), lechuga_crespa: Math.round(crespaPlantas), lechuga_roble: Math.round(roblePlantas) };
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

// ── Comparación Plan vs. Real, para entender por qué difieren ──

// Cosecha real por semana calendario (lunes a domingo), últimas N semanas COMPLETAS
// (la semana en curso queda afuera del promedio por estar incompleta y subestimar el
// ritmo real). Rúcula en paquetes, lechuga en plantas — mismas unidades que el total
// semanal que calcula la calculadora (totRucPaq/totLecPlantas).
export interface CosechaSemanalReal { semanaLabel: string; ruculaPaq: number; lechugaPlantas: number }
export function cosechaRealUltimasSemanas(lotes: Lote[], movimientos: Movimiento[], nSemanas = 6): CosechaSemanalReal[] {
  const lotesMap = new Map(lotes.map(l => [l.id_lote, l]));
  const hoy = new Date();
  const lunesDeSemana = (d: Date) => { const r = new Date(d); const dow = r.getDay(); r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1)); r.setHours(0, 0, 0, 0); return r; };
  const lunesActual = lunesDeSemana(hoy);
  const out: CosechaSemanalReal[] = [];
  for (let i = nSemanas; i >= 1; i--) {
    const inicio = new Date(lunesActual); inicio.setDate(inicio.getDate() - i * 7);
    const fin = new Date(inicio); fin.setDate(fin.getDate() + 7);
    let ruculaPaq = 0, lechugaPlantas = 0;
    for (const m of movimientos) {
      if (m.tipo !== 'cosecha' || !m.fecha) continue;
      const f = new Date(String(m.fecha).split(/[T ]/)[0] + 'T12:00:00');
      if (isNaN(f.getTime()) || f < inicio || f >= fin) continue;
      const lote = lotesMap.get(String(m.id_lote || ''));
      const u = Number(m.unidades_cosechadas) || 0;
      if (esRuculaVar(lote?.variedad || '')) ruculaPaq += u; else lechugaPlantas += u;
    }
    out.push({ semanaLabel: i === 1 ? 'Sem. pasada' : `S-${i}`, ruculaPaq, lechugaPlantas });
  }
  return out;
}

// Ciclo real reciente (últimos N días) por cultivo — para comparar contra los días que
// el usuario está usando en la calculadora ("Días en perfil"). Si el ciclo real quedó
// más largo que el configurado, el plan sobreestima el rendimiento real.
export interface CicloRealReciente { rucula: { dias: number; muestras: number }; lechuga: { fase1: number; fase2: number; muestras: number } }
export function ciclosRealesRecientes(lotes: Lote[], movimientos: Movimiento[], ultimosNDias = 60): CicloRealReciente {
  const limite = new Date(); limite.setDate(limite.getDate() - ultimosNDias);
  const cosechados = lotes.filter(l => {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) return false;
    const f = new Date(String(l.fecha_cosecha).split(/[T ]/)[0] + 'T12:00:00');
    return !isNaN(f.getTime()) && f >= limite;
  });
  const diasDe = (l: Lote) => { try { return calcularDiasPorFase(l, movimientos); } catch { return null; } };
  const prom = (xs: number[]) => xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

  const ruculaDias = cosechados.filter(l => esRuculaVar(l.variedad)).map(diasDe)
    .filter((d): d is NonNullable<typeof d> => d !== null).map(d => d.fase_2 || d.total).filter(d => d > 0);
  const lechugaDias = cosechados.filter(l => !esRuculaVar(l.variedad)).map(diasDe)
    .filter((d): d is NonNullable<typeof d> => d !== null);
  const lechugaF1 = lechugaDias.map(d => d.fase_1).filter((d): d is number => d !== null && d > 0);
  const lechugaF2 = lechugaDias.map(d => d.fase_2).filter(d => d > 0);

  return {
    rucula: { dias: prom(ruculaDias), muestras: ruculaDias.length },
    lechuga: { fase1: prom(lechugaF1), fase2: prom(lechugaF2), muestras: lechugaF2.length },
  };
}
