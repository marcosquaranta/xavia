import type { Lote, Movimiento } from './types';
import { calcularDiasPorFase, codigoCultivo } from './lotes';

function safeParseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).trim(); if (!str) return null;
  let yyyy = '', mm = '', dd = '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) { [yyyy, mm, dd] = str.split('-'); }
  else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) { [yyyy, mm, dd] = str.split('/'); }
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) { [dd, mm, yyyy] = str.split('/'); }
  else { const d = new Date(str); if (!isNaN(d.getTime())) return d; return null; }
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

function som(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function eom(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59); }

export interface EstadisticaMes { variedad: string; cosechado: number; ciclo_promedio: number; rendimiento_kg_por_unidad: number; }

export function estadisticasDelMes(lotes: Lote[], movimientos: Movimiento[], mes: Date): EstadisticaMes[] {
  try {
    const inicio = som(mes); const fin = eom(mes);
    const lotesCosechados = lotes.filter((l) => { if (l.estado !== 'cosechado') return false; const f = safeParseDate(l.fecha_cosecha); return f && f >= inicio && f <= fin; });
    const variedades = Array.from(new Set(lotesCosechados.map((l) => l.variedad).filter(Boolean)));
    return variedades.map((variedad) => {
      const g = lotesCosechados.filter((l) => l.variedad === variedad);
      const cosechado = g.reduce((acc, l) => acc + (Number(l.unidades_cosechadas) || 0), 0);
      const ciclos = g.map((l) => { try { return calcularDiasPorFase(l, movimientos).total; } catch { return 0; } });
      const ciclo_promedio = ciclos.length > 0 ? Math.round(ciclos.reduce((a, b) => a + b, 0) / ciclos.length) : 0;
      const peso = g.reduce((acc, l) => acc + (Number(l.peso_total_estimado_kg) || 0), 0);
      return { variedad, cosechado, ciclo_promedio, rendimiento_kg_por_unidad: cosechado > 0 ? Math.round((peso / cosechado) * 1000) / 1000 : 0 };
    });
  } catch { return []; }
}

export function ciclosPorMesYAnio(lotes: Lote[], movimientos: Movimiento[], anio: number): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>();
  try {
    for (const l of lotes.filter((l) => { if (l.estado !== 'cosechado') return false; const f = safeParseDate(l.fecha_cosecha); return f && f.getFullYear() === anio; })) {
      try {
        const f = safeParseDate(l.fecha_cosecha); if (!f) continue;
        const mes = f.getMonth(); const dias = calcularDiasPorFase(l, movimientos).total;
        if (!result.has(l.variedad)) result.set(l.variedad, new Map());
        const map = result.get(l.variedad)!;
        map.set(mes, (map.get(mes) || 0) + dias);
        map.set(mes + 100, (map.get(mes + 100) || 0) + 1);
      } catch { continue; }
    }
    for (const [variedad, map] of result.entries()) {
      const final = new Map<number, number>();
      for (let m = 0; m < 12; m++) { const t = map.get(m); const c = map.get(m + 100); if (t && c) final.set(m, Math.round(t / c)); }
      result.set(variedad, final);
    }
  } catch { }
  return result;
}

export interface DiasPromedioVariedad { variedad: string; plantinera: number; fase_1: number | null; fase_2: number; total: number; lotes_count: number; }

export function diasPromedioPorVariedad(lotes: Lote[], movimientos: Movimiento[], ultimosNDias: number = 60): DiasPromedioVariedad[] {
  try {
    const limite = new Date(); limite.setDate(limite.getDate() - ultimosNDias);
    const relevantes = lotes.filter((l) => { if (l.estado !== 'cosechado') return false; const f = safeParseDate(l.fecha_cosecha); return f && f >= limite; });
    return Array.from(new Set(relevantes.map((l) => l.variedad).filter(Boolean))).map((variedad) => {
      const g = relevantes.filter((l) => l.variedad === variedad);
      const dias = g.map((l) => { try { return calcularDiasPorFase(l, movimientos); } catch { return { plantinera: 0, fase_1: null, fase_2: 0, total: 0, fechas: { siembra: '', fase_1_inicio: null, fase_2_inicio: null, cosecha: null } }; } });
      const prom = (xs: number[]) => xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
      const f1list = dias.map((d) => d.fase_1).filter((d): d is number => d !== null);
      return { variedad, plantinera: prom(dias.map((d) => d.plantinera)), fase_1: f1list.length > 0 ? prom(f1list) : null, fase_2: prom(dias.map((d) => d.fase_2)), total: prom(dias.map((d) => d.total)), lotes_count: g.length };
    });
  } catch { return []; }
}

export function mapaDiasPromedio(lotes: Lote[], movimientos: Movimiento[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of diasPromedioPorVariedad(lotes, movimientos, 90)) map.set(s.variedad, s.total);
  return map;
}

export interface CosechaSemana { lechuga_crespa: number; lechuga_roble: number; rucula_paquetes: number; albahaca_paquetes: number; }

export function cosechaSemanaActual(lotes: Lote[]): CosechaSemana {
  const stats: CosechaSemana = { lechuga_crespa: 0, lechuga_roble: 0, rucula_paquetes: 0, albahaca_paquetes: 0 };
  try {
    const hoy = new Date(); const inicio = new Date(hoy);
    const dow = inicio.getDay() === 0 ? 7 : inicio.getDay(); inicio.setDate(hoy.getDate() - dow + 1); inicio.setHours(0, 0, 0, 0);
    for (const l of lotes) {
      if (l.estado !== 'cosechado') continue;
      const f = safeParseDate(l.fecha_cosecha); if (!f || f < inicio) continue;
      const v = String(l.variedad || '').toLowerCase(); const u = Number(l.unidades_cosechadas) || 0;
      if (v.includes('crespa')) stats.lechuga_crespa += u;
      else if (v.includes('roble')) stats.lechuga_roble += u;
      else if (codigoCultivo(l.variedad) === 'R') stats.rucula_paquetes += u;
      else if (codigoCultivo(l.variedad) === 'A') stats.albahaca_paquetes += u;
    }
  } catch { }
  return stats;
}

export function cosechadoEsteMes(lotes: Lote[]): { actual: number; pasado: number } {
  let actual = 0; let pasado = 0;
  try {
    const hoy = new Date(); const iA = som(hoy);
    const mp = new Date(hoy); mp.setMonth(mp.getMonth() - 1); const iP = som(mp); const fP = eom(mp);
    for (const l of lotes) {
      if (l.estado !== 'cosechado') continue;
      const f = safeParseDate(l.fecha_cosecha); if (!f) continue;
      const u = Number(l.unidades_cosechadas) || 0;
      if (f >= iA) actual += u; else if (f >= iP && f <= fP) pasado += u;
    }
  } catch { }
  return { actual, pasado };
}

export interface PlantasPorFase { plantinera: number; fase_1: number; fase_2: number; total: number; }
export interface ResumenCultivos { lechuga: PlantasPorFase; rucula: PlantasPorFase; albahaca: PlantasPorFase; }

export function plantasPorCultivo(lotes: Lote[]): ResumenCultivos {
  const res: ResumenCultivos = {
    lechuga: { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 },
    rucula: { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 },
    albahaca: { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 },
  };
  for (const l of lotes) {
    if (l.estado !== 'activo') continue;
    const v = String(l.variedad || '').toLowerCase();
    const key: keyof ResumenCultivos = v.includes('rucula') || v.includes('rúcula') ? 'rucula' : v.includes('albahaca') ? 'albahaca' : 'lechuga';
    const plantas = Number(l.plantas_estimadas_actual) || Number(l.plantines_iniciales) || 0;
    if (l.fase_actual === 'plantin') res[key].plantinera += plantas;
    else if (l.fase_actual === 'fase_1') res[key].fase_1 += plantas;
    else if (l.fase_actual === 'fase_2') res[key].fase_2 += plantas;
    res[key].total += plantas;
  }
  return res;
}

export function variacionVsMesAnterior(lotes: Lote[], clave: keyof ResumenCultivos): number | null {
  try {
    const hoy = new Date(); const iA = som(hoy);
    const mp = new Date(hoy); mp.setMonth(mp.getMonth() - 1); const iP = som(mp); const fP = eom(mp);
    function match(v: string): boolean {
      const vl = v.toLowerCase();
      if (clave === 'rucula') return vl.includes('rucula') || vl.includes('rúcula');
      if (clave === 'albahaca') return vl.includes('albahaca');
      return !vl.includes('rucula') && !vl.includes('rúcula') && !vl.includes('albahaca');
    }
    let actual = 0; let pasado = 0;
    for (const l of lotes.filter((l) => l.estado === 'cosechado' && match(l.variedad))) {
      const f = safeParseDate(l.fecha_cosecha); if (!f) continue;
      const u = Number(l.unidades_cosechadas) || 0;
      if (f >= iA) actual += u; else if (f >= iP && f <= fP) pasado += u;
    }
    if (pasado === 0) return null;
    return Math.round(((actual - pasado) / pasado) * 100);
  } catch { return null; }
}

// === DISTRIBUCIÓN DE LOTES POR SEMANA DE CICLO ===

export interface BarraSemana {
  semana: number;
  plantas_f1: number;
  plantas_f2: number;
  plantas_cosechadas?: number;
  lotes: string[];
}

export interface DatosCicloGrafico {
  barras: BarraSemana[];
  semanasCosecha: number;  // semana estimada de cosecha según la variedad
}

/**
 * Agrupa los lotes activos en F1/F2 por semana de ciclo (días desde siembra ÷ 7).
 * Excluye plantinera porque no ocupa espacio en mesadas.
 * Usa el promedio de días estimados de las variedades del cultivo para marcar la línea de cosecha.
 */
export function distribucionPorSemana(
  lotes: Lote[],
  variedades: import('./types').Variedad[],
  cultivo: 'lechuga' | 'rucula'
): DatosCicloGrafico {
  const hoy = new Date();
  const hace7dias = new Date(hoy);
  hace7dias.setDate(hace7dias.getDate() - 7);

  function matchCultivo(v: string): boolean {
    const vl = String(v || '').toLowerCase();
    if (cultivo === 'rucula') return vl.includes('rucula') || vl.includes('rúcula');
    return !vl.includes('rucula') && !vl.includes('rúcula') && !vl.includes('albahaca');
  }

  const mapa = new Map<number, BarraSemana>();

  // Lotes activos en F1/F2
  const activos = lotes.filter((l) =>
    l.estado === 'activo' &&
    (l.fase_actual === 'fase_1' || l.fase_actual === 'fase_2') &&
    matchCultivo(l.variedad)
  );

  for (const l of activos) {
    const siembra = safeParseDate2(l.fecha_siembra);
    if (!siembra) continue;
    const diasVida = Math.max(0, Math.round((hoy.getTime() - siembra.getTime()) / 86400000));
    const semana = Math.max(1, Math.ceil(diasVida / 7));
    const plantas = Number(l.plantas_estimadas_actual) || Number(l.plantines_iniciales) || 0;
    if (!mapa.has(semana)) mapa.set(semana, { semana, plantas_f1: 0, plantas_f2: 0, plantas_cosechadas: 0, lotes: [] });
    const b = mapa.get(semana)!;
    if (l.fase_actual === 'fase_1') b.plantas_f1 += plantas;
    else b.plantas_f2 += plantas;
    b.lotes.push(l.id_lote);
  }

  // Lotes cosechados en los últimos 7 días
  const recienCosechados = lotes.filter((l) => {
    if (l.estado !== 'cosechado') return false;
    if (!matchCultivo(l.variedad)) return false;
    const fCosecha = safeParseDate2(l.fecha_cosecha);
    return fCosecha && fCosecha >= hace7dias;
  });

  for (const l of recienCosechados) {
    const siembra = safeParseDate2(l.fecha_siembra);
    const cosecha = safeParseDate2(l.fecha_cosecha);
    if (!siembra || !cosecha) continue;
    const diasVida = Math.max(0, Math.round((cosecha.getTime() - siembra.getTime()) / 86400000));
    const semana = Math.max(1, Math.ceil(diasVida / 7));
    const plantas = Number(l.plantas_estimadas_actual) || Number(l.unidades_cosechadas) || 0;
    if (!mapa.has(semana)) mapa.set(semana, { semana, plantas_f1: 0, plantas_f2: 0, plantas_cosechadas: 0, lotes: [] });
    const b = mapa.get(semana)!;
    b.plantas_cosechadas = (b.plantas_cosechadas || 0) + plantas;
    b.lotes.push(l.id_lote);
  }

  // Semana estimada de cosecha
  const varsCultivo = variedades.filter((v) => v.activo === 'SI' && matchCultivo(v.variedad));
  const diasProm = varsCultivo.length > 0
    ? varsCultivo.reduce((acc, v) => acc + (Number(v.dias_estimados_cosecha) || 35), 0) / varsCultivo.length
    : 35;
  const semanasCosecha = Math.ceil(diasProm / 7);

  const barras = Array.from(mapa.values()).sort((a, b) => a.semana - b.semana);
  return { barras, semanasCosecha };
}

function safeParseDate2(s: any): Date | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  let yyyy = '', mm = '', dd = '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) { [yyyy, mm, dd] = str.split('-'); }
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) { [dd, mm, yyyy] = str.split('/'); }
  else { const d = new Date(str); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

// === RESUMEN DE COSECHA POR CULTIVO ===

export interface ResumenCosechaCultivo {
  cultivo: 'lechuga' | 'rucula';
  label: string;
  cosechadoMes: number;
  cosechadoMesAntProporcional: number; // solo hasta el mismo día del mes anterior
  variacionPct: number | null;
  proyectadoRestoMes: number; // plantas de lotes activos que cosecharían este mes
}

export function resumenCosechaPorCultivo(
  lotes: Lote[],
  variedades: import('./types').Variedad[]
): ResumenCosechaCultivo[] {
  const hoy = new Date();
  const diaHoy = hoy.getDate();
  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();

  // Inicio del mes actual
  const inicioMesActual = new Date(anioActual, mesActual, 1);

  // Mes anterior — mismo día
  const mesPasado = new Date(anioActual, mesActual - 1, 1);
  const finProporcionalMesPasado = new Date(anioActual, mesActual - 1, diaHoy, 23, 59, 59);

  // Fin del mes actual (para proyección)
  const finMesActual = new Date(anioActual, mesActual + 1, 0, 23, 59, 59);

  function matchCultivo(variedad: string, cultivo: 'lechuga' | 'rucula'): boolean {
    const v = String(variedad || '').toLowerCase();
    if (cultivo === 'rucula') return v.includes('rucula') || v.includes('rúcula');
    return !v.includes('rucula') && !v.includes('rúcula') && !v.includes('albahaca');
  }

  function calcularFechaCosechaEstimada(lote: Lote): Date | null {
    try {
      const siembra = safeParseDate(lote.fecha_siembra);
      if (!siembra) return null;
      const varDef = variedades.find((v) => v.variedad === lote.variedad);
      const diasCiclo = Number(varDef?.dias_estimados_cosecha) || 35;
      const est = new Date(siembra);
      est.setDate(est.getDate() + diasCiclo);
      return est;
    } catch { return null; }
  }

  return (['lechuga', 'rucula'] as const).map((cultivo) => {
    const label = cultivo === 'lechuga' ? 'Lechuga' : 'Rúcula';

    // Cosechados este mes
    const cosechadoMes = lotes
      .filter((l) => {
        if (l.estado !== 'cosechado') return false;
        if (!matchCultivo(l.variedad, cultivo)) return false;
        const f = safeParseDate(l.fecha_cosecha);
        return f && f >= inicioMesActual && f <= hoy;
      })
      .reduce((acc, l) => acc + (Number(l.unidades_cosechadas) || 0), 0);

    // Cosechados mes anterior (solo hasta el mismo día)
    const cosechadoMesAntProporcional = lotes
      .filter((l) => {
        if (l.estado !== 'cosechado') return false;
        if (!matchCultivo(l.variedad, cultivo)) return false;
        const f = safeParseDate(l.fecha_cosecha);
        return f && f >= mesPasado && f <= finProporcionalMesPasado;
      })
      .reduce((acc, l) => acc + (Number(l.unidades_cosechadas) || 0), 0);

    const variacionPct = cosechadoMesAntProporcional > 0
      ? Math.round(((cosechadoMes - cosechadoMesAntProporcional) / cosechadoMesAntProporcional) * 100)
      : null;

    // Proyectado: solo lotes en F2 cuya fecha estimada de cosecha cae en el resto del mes
    // Usa fecha_f2 + días restantes de F2 para ser más preciso
    const proyectadoRestoMes = lotes
      .filter((l) => {
        if (l.estado !== 'activo') return false;
        if (l.fase_actual !== 'fase_2') return false;
        if (!matchCultivo(l.variedad, cultivo)) return false;
        // Intentar usar fecha_f2 si existe
        const varDef = variedades.find((v) => v.variedad === l.variedad);
        const diasCiclo = Number(varDef?.dias_estimados_cosecha) || 35;
        // Calcular fecha estimada de cosecha desde siembra
        const siembra = safeParseDate(l.fecha_siembra);
        if (!siembra) return false;
        const est = new Date(siembra);
        est.setDate(est.getDate() + diasCiclo);
        return est >= hoy && est <= finMesActual;
      })
      .reduce((acc, l) => acc + (Number(l.plantas_estimadas_actual) || 0), 0);

    return { cultivo, label, cosechadoMes, cosechadoMesAntProporcional, variacionPct, proyectadoRestoMes };
  });
}

// === CICLO REAL POR VARIEDAD ===
// Calcula el promedio de días de ciclo de los últimos N lotes cosechados de una variedad
export function cicloRealPorVariedad(
  lotes: Lote[],
  movimientos: import('./types').Movimiento[],
  ultimos: number = 5
): Map<string, number> {
  const resultado = new Map<string, number>();
  const variedades = Array.from(new Set(lotes.filter(l => l.estado === 'cosechado').map(l => l.variedad)));
  
  for (const variedad of variedades) {
    const cosechados = lotes
      .filter(l => l.estado === 'cosechado' && l.variedad === variedad)
      .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')))
      .slice(0, ultimos);
    
    if (cosechados.length === 0) continue;
    
    const dias = cosechados
      .map(l => {
        try { return calcularDiasPorFase(l, movimientos).total; } catch { return 0; }
      })
      .filter(d => d > 0);
    
    if (dias.length > 0) {
      resultado.set(variedad, Math.round(dias.reduce((a, b) => a + b, 0) / dias.length));
    }
  }
  return resultado;
}
