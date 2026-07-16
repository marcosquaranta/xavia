import type { Lote, Movimiento, Ubicacion } from './types';
import { calcularDiasPorFase } from './lotes';

export type PeriodoCapacidad = 'd90' | 'd180' | 'anio';

export interface CicloMesada {
  nombre: string; nave: number;
  tipo: 'lechuga' | 'rucula' | 'mixta';
  lechugaF1: number; lechugaF2: number; lechugaTotal: number; lechugaN: number; lechugaF1N: number;
  ruculaF2: number; ruculaTotal: number; ruculaN: number;
  pesoGrLechuga: number; pesoGrRucula: number;
  plantasPaqLechuga: number; plantasPaqRucula: number;
  posiciones: number; sectorFase: string;
  produccionRealLechuga: number; produccionRealRucula: number; // paquetes realmente cosechados en el período, de ESTA mesada
}

// F1 y F2 son etapas SECUENCIALES, no simultáneas: una planta ocupa primero F1 y recién
// después F2. Lo que determina cuántos paquetes/mes puede dar una mesada de F2 es SU
// ciclo F2 (cuánto tarda en liberarse una posición ahí), no el ciclo total F1+F2. La
// "producción teórica" usa el ciclo F2 promedio PONDERADO de toda la nave+cultivo (no el
// de cada mesada individual, que puede estar basado en 1 sola cosecha y ser poco
// confiable) — la "producción real" es lo efectivamente cosechado en el período,
// MENSUALIZADO (dividido por los meses que abarca el período filtrado) para que sea
// comparable en la misma unidad que la teórica (paquetes/MES), no un total crudo del
// período. Las mesadas F1 de lechuga son buffer puro (no cosechan directo) y no entran
// en esta tabla — su ciclo F1 se sigue viendo en "Ciclos por mesada" arriba.
export interface FilaCapacidadProd {
  nombre: string; nave: number; cultivo: 'Lechuga' | 'Rúcula';
  cicloActual: number; posiciones: number;
  produccionTeorica: number; produccionReal: number; n: number; difPct: number | null;
}

export interface KpiNave { nave: number; lechuga: number; rucula: number; total: number }
export interface KpiCultivo { cultivo: 'Lechuga' | 'Rúcula'; posiciones: number; teorica: number; real: number; difPct: number | null }

// % de la producción teórica que NO se cumplió: (teórica - real) / teórica × 100.
// Positivo = por debajo de lo teórico (shortfall); negativo = por encima.
export function calcularDifPct(teorica: number, real: number): number | null {
  if (!(teorica > 0)) return null;
  return Math.round(((teorica - real) / teorica) * 1000) / 10;
}
// La cuenta que arma cada número de producción, para poder mostrarla explícita en la UI
// y que se pueda auditar de dónde sale (posiciones → plantas → paquetes).
export interface ResumenGrupo { cultivo: 'Lechuga' | 'Rúcula'; nave: number; ciclo: number; plantasPorPosicion: number; plantasPorPaq: number }

export interface CapacidadProductiva {
  ciclosMesadas: CicloMesada[];
  filasCapacidad: FilaCapacidadProd[];
  kpiPorNave: KpiNave[];
  kpiPorCultivo: KpiCultivo[];
  kpiTotalTeorica: number; kpiTotalReal: number; kpiTotalDifPct: number | null;
  resumenGrupos: ResumenGrupo[];
}

export function cosechadosEnPeriodo(lotes: Lote[], periodo: PeriodoCapacidad): Lote[] {
  const todos = lotes.filter(l => l.estado === 'cosechado');
  const ahora = new Date();
  let desde: Date;
  if (periodo === 'd90') {
    desde = new Date(ahora); desde.setDate(desde.getDate() - 90);
  } else if (periodo === 'd180') {
    desde = new Date(ahora); desde.setDate(desde.getDate() - 180);
  } else { // anio
    desde = new Date(ahora.getFullYear(), 0, 1);
  }
  return todos.filter(l => new Date(String(l.fecha_cosecha) + 'T12:00:00') >= desde);
}

// Cuántos meses (equivalentes en días/30) abarca el período filtrado — para "mensualizar"
// la producción real y poder compararla contra la teórica (que siempre es una tasa
// mensual), sin importar qué período haya elegido el usuario.
function mesesEnPeriodo(periodo: PeriodoCapacidad): number {
  const ahora = new Date();
  let dias: number;
  if (periodo === 'd90') {
    dias = 90;
  } else if (periodo === 'd180') {
    dias = 180;
  } else { // anio
    const inicio = new Date(ahora.getFullYear(), 0, 1);
    dias = Math.floor((ahora.getTime() - inicio.getTime()) / 86400000) + 1;
  }
  return Math.max(dias, 1) / 30;
}

export function calcularCapacidadProductiva(
  lotes: Lote[], movimientos: Movimiento[], ubicaciones: Ubicacion[],
  periodo: PeriodoCapacidad = 'anio', naveFilter: string = 'todas'
): CapacidadProductiva {
  const cosechados = cosechadosEnPeriodo(lotes, periodo);

  // Mapear id_lote → dias por fase
  const diasPorLote = new Map<string, { f1: number | null; f2: number; total: number; variedad: string; nave: number }>();
  for (const l of cosechados) {
    try {
      const dias = calcularDiasPorFase(l, movimientos);
      if (dias.total < 20) continue;
      const nav = String(l.ubicacion_actual || l.id_lote || '').toLowerCase().includes('n1') ||
                  String(l.ubicacion_actual || '').toLowerCase().includes('nave 1') ? 1 : 2;
      diasPorLote.set(l.id_lote, { f1: dias.fase_1, f2: dias.fase_2, total: dias.total, variedad: l.variedad, nave: nav });
    } catch {}
  }

  // Peso promedio y plantas/paquete por lote cosechado
  const pesoLoteMap = new Map<string, { gr: number; ppu: number; esRucula: boolean }>();
  for (const l of cosechados) {
    const gr = Number(l.peso_muestra_paquete_gr) > 0
      ? Number(l.peso_muestra_paquete_gr)
      : Number(l.peso_muestra_kg) > 0 ? Math.round(Number(l.peso_muestra_kg) * 1000) : 0;
    const ppu = Number(l.plantas_por_unidad_real) || 0;
    if (gr > 0 || ppu > 0) {
      const v = String(l.variedad || '').toLowerCase();
      pesoLoteMap.set(l.id_lote, { gr, ppu, esRucula: v.includes('rucula') || v.includes('rúcula') });
    }
  }

  // Normaliza nombres de mesada: quita prefijo "Nave X -", acentos, sufijos "(...)", minúsculas
  const normMes = (s: string) => String(s || '')
    .replace(/^Nave\s*\d+\s*-\s*/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const naveDe = (ubic: string) => {
    const m = String(ubic || '').match(/nave\s*(\d+)/i);
    if (m) return Number(m[1]);
    return String(ubic || '').toLowerCase().includes('n1') ? 1 : 2;
  };

  const mesadas = ubicaciones.filter(u => u.tipo === 'mesada' && u.activo === 'SI');
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const ciclosMesadas: CicloMesada[] = [];

  for (const mes of mesadas) {
    if (naveFilter !== 'todas' && String(mes.nave) !== naveFilter) continue;

    const mesKey = normMes(mes.nombre);
    const mesNave = Number(mes.nave);
    const esRuculaMesada = mesKey.includes('rucula');
    const esLechugaMesada = mesKey.includes('lechuga');
    const tipo: CicloMesada['tipo'] = esRuculaMesada ? 'rucula' : esLechugaMesada ? 'lechuga' : 'mixta';

    // Lotes cosechados que pasaron por esta mesada (matching normalizado: sin acentos/sufijos/prefijo)
    const lotesEnMesada = new Set(
      movimientos.filter(m => normMes(m.ubicacion_destino) === mesKey).map(m => m.id_lote)
    );

    const lF1: number[] = [], lF2: number[] = [], rF2: number[] = [];
    const pLech: number[] = [], pRuc: number[] = [];
    const ppLech: number[] = [], ppRuc: number[] = [];
    let realLech = 0, realRuc = 0;

    for (const idLote of lotesEnMesada) {
      const d = diasPorLote.get(String(idLote));
      if (!d || d.nave !== mesNave) continue;
      const vNorm = d.variedad.toLowerCase();
      const esR = vNorm.includes('rucula') || vNorm.includes('rúcula');
      if (esR) { if (d.f2 > 0) rF2.push(d.f2); }
      else { if (d.f1 !== null && d.f1 > 0) lF1.push(d.f1); if (d.f2 > 0) lF2.push(d.f2); }
    }

    // Peso, plantas/paquete y producción real: via ubicacion_actual (guarda la mesada
    // donde estaba al cosechar), matching normalizado + nave.
    for (const l of cosechados) {
      if (normMes(l.ubicacion_actual) !== mesKey) continue;
      if (naveDe(l.ubicacion_actual) !== mesNave) continue;
      const esR = String(l.variedad || '').toLowerCase().includes('rucula') || String(l.variedad || '').toLowerCase().includes('rúcula');
      const paq = Number(l.unidades_cosechadas) || 0;
      if (esR) realRuc += paq; else realLech += paq;
      const p = pesoLoteMap.get(l.id_lote);
      if (!p) continue;
      if (p.gr > 0) (p.esRucula ? pRuc : pLech).push(p.gr);
      if (p.ppu > 0) (p.esRucula ? ppRuc : ppLech).push(p.ppu);
    }

    // Posiciones instaladas de ESTA mesada puntual: módulos × perfiles/módulo × orificios/perfil.
    const modulosMes = Number(mes.modulos) || 1;
    const perfilesMes = modulosMes * (Number(mes.perfiles_por_modulo) || 0);
    const orifPerfMes = Number(mes.orificios_por_perfil) || 0;
    const posicionesMes = perfilesMes * orifPerfMes;

    ciclosMesadas.push({
      nombre: mes.nombre.replace(/^Nave \d+ - /, ''),
      nave: Number(mes.nave), tipo,
      lechugaF1: avg(lF1), lechugaF2: avg(lF2),
      lechugaTotal: avg(lF1.map((f, i) => f + (lF2[i] || 0))),
      lechugaN: Math.max(lF1.length, lF2.length), lechugaF1N: lF1.length,
      ruculaF2: avg(rF2), ruculaTotal: avg(rF2), ruculaN: rF2.length,
      pesoGrLechuga: avg(pLech), pesoGrRucula: avg(pRuc),
      plantasPaqLechuga: avg(ppLech), plantasPaqRucula: avg(ppRuc),
      posiciones: posicionesMes, sectorFase: String(mes.sector_fase || ''),
      produccionRealLechuga: realLech, produccionRealRucula: realRuc,
    });
  }

  // Ciclo F2 promedio PONDERADO por (nave, cultivo): pool exacto de todas las cosechas de
  // esa nave+cultivo (no el promedio de promedios), para no depender del ciclo de una sola
  // mesada que puede tener muestra chica. mean_pool = Σ(promedio_mesada × n_mesada) / Σ(n_mesada).
  function cicloPromedioNaveCultivo(nave: number, esRuc: boolean): number {
    const deGrupo = ciclosMesadas.filter(m => {
      if (m.nave !== nave) return false;
      const mEsRuc = m.tipo === 'rucula' || (m.tipo === 'mixta' && m.ruculaN > 0 && m.lechugaN === 0);
      if (mEsRuc !== esRuc) return false;
      if (!esRuc && m.sectorFase === 'fase_1') return false; // buffer no entra en el pool de F2
      return true;
    });
    const dias = esRuc ? deGrupo.map(m => m.ruculaF2) : deGrupo.map(m => m.lechugaF2);
    const ns = esRuc ? deGrupo.map(m => m.ruculaN) : deGrupo.map(m => m.lechugaN);
    let sumaPonderada = 0, sumaN = 0;
    for (let i = 0; i < deGrupo.length; i++) {
      if (dias[i] > 0 && ns[i] > 0) { sumaPonderada += dias[i] * ns[i]; sumaN += ns[i]; }
    }
    return sumaN > 0 ? sumaPonderada / sumaN : 0;
  }

  const meses = mesesEnPeriodo(periodo);

  const filasCapacidad: FilaCapacidadProd[] = ciclosMesadas
    .filter(m => {
      // Las mesadas F1 de lechuga son buffer puro (no cosechan directo) — no entran en esta tabla.
      const esRuc = m.tipo === 'rucula' || (m.tipo === 'mixta' && m.ruculaN > 0 && m.lechugaN === 0);
      return esRuc || m.sectorFase !== 'fase_1';
    })
    .map((m) => {
      const esRuc = m.tipo === 'rucula' || (m.tipo === 'mixta' && m.ruculaN > 0 && m.lechugaN === 0);
      const cicloActual = esRuc ? m.ruculaF2 : m.lechugaF2;
      const n = esRuc ? m.ruculaN : m.lechugaN;
      const cicloNave = cicloPromedioNaveCultivo(m.nave, esRuc);
      const ciclosPorMes = cicloNave > 0 ? (30 / cicloNave) : 0;
      const plantasPorMes = Math.round(m.posiciones * ciclosPorMes);
      const plantasPorPaq = esRuc ? (m.plantasPaqRucula > 0 ? m.plantasPaqRucula : 3) : 1;
      const produccionTeorica = esRuc ? Math.round(plantasPorMes / plantasPorPaq) : plantasPorMes;
      const produccionRealBruta = esRuc ? m.produccionRealRucula : m.produccionRealLechuga;
      const produccionReal = Math.round(produccionRealBruta / meses);
      return {
        nombre: m.nombre, nave: m.nave, cultivo: (esRuc ? 'Rúcula' : 'Lechuga') as 'Lechuga' | 'Rúcula',
        cicloActual, posiciones: m.posiciones, produccionTeorica, produccionReal, n,
        difPct: calcularDifPct(produccionTeorica, produccionReal),
      };
    }).sort((a, b) => (a.cultivo === b.cultivo ? 0 : a.cultivo === 'Lechuga' ? -1 : 1) || a.nave - b.nave || a.nombre.localeCompare(b.nombre));

  const navesConCapacidad = Array.from(new Set(filasCapacidad.map(f => f.nave))).sort((a, b) => a - b);
  const kpiPorNave: KpiNave[] = navesConCapacidad.map((nv) => {
    const deNave = filasCapacidad.filter(f => f.nave === nv);
    const lechuga = deNave.filter(f => f.cultivo === 'Lechuga').reduce((a, f) => a + f.produccionTeorica, 0);
    const rucula = deNave.filter(f => f.cultivo === 'Rúcula').reduce((a, f) => a + f.produccionTeorica, 0);
    return { nave: nv, lechuga, rucula, total: lechuga + rucula };
  });

  const cultivosConCapacidad = Array.from(new Set(filasCapacidad.map(f => f.cultivo))) as ('Lechuga' | 'Rúcula')[];
  const kpiPorCultivo: KpiCultivo[] = cultivosConCapacidad.map((cul) => {
    const deCultivo = filasCapacidad.filter(f => f.cultivo === cul);
    const teorica = deCultivo.reduce((a, f) => a + f.produccionTeorica, 0);
    const real = deCultivo.reduce((a, f) => a + f.produccionReal, 0);
    return {
      cultivo: cul,
      posiciones: deCultivo.reduce((a, f) => a + f.posiciones, 0),
      teorica, real, difPct: calcularDifPct(teorica, real),
    };
  });
  const kpiTotalTeorica = kpiPorCultivo.reduce((a, k) => a + k.teorica, 0);
  const kpiTotalReal = kpiPorCultivo.reduce((a, k) => a + k.real, 0);
  const kpiTotalDifPct = calcularDifPct(kpiTotalTeorica, kpiTotalReal);

  // Resumen de la cuenta (ciclo + factores) por cada combinación nave+cultivo presente,
  // para mostrar de forma transparente cómo se llega a la producción teórica.
  const gruposUnicos = Array.from(new Set(filasCapacidad.map(f => `${f.nave}|${f.cultivo}`)));
  const resumenGrupos: ResumenGrupo[] = gruposUnicos.map((key) => {
    const [naveStr, cultivo] = key.split('|') as [string, 'Lechuga' | 'Rúcula'];
    const nave = Number(naveStr);
    const esRuc = cultivo === 'Rúcula';
    const ciclo = Math.round(cicloPromedioNaveCultivo(nave, esRuc));
    const deGrupo = ciclosMesadas.filter(m => {
      if (m.nave !== nave) return false;
      const mEsRuc = m.tipo === 'rucula' || (m.tipo === 'mixta' && m.ruculaN > 0 && m.lechugaN === 0);
      return mEsRuc === esRuc;
    });
    const medidos = esRuc ? deGrupo.map(m => m.plantasPaqRucula).filter(v => v > 0) : [];
    const plantasPorPaq = esRuc
      ? (medidos.length ? Math.round((medidos.reduce((a, b) => a + b, 0) / medidos.length) * 10) / 10 : 3)
      : 1;
    return { cultivo, nave, ciclo, plantasPorPosicion: 1, plantasPorPaq };
  });

  return { ciclosMesadas, filasCapacidad, kpiPorNave, kpiPorCultivo, kpiTotalTeorica, kpiTotalReal, kpiTotalDifPct, resumenGrupos };
}
