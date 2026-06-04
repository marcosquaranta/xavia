import type { Lote, Movimiento } from './types';
import { calcularDiasPorFase, codigoCultivo } from './lotes';

function safeParseDate(s: any): Date | null {
  if (!s) return null;
  // Truncar al primer espacio o 'T' para eliminar la hora si viene incluida
  const str = String(s).trim().split(/[\sT]/)[0]; if (!str) return null;
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
  // Usar ciclo real de cosechados en lugar del valor de la hoja Variedades
  const ciclosMap = cicloRealPorVariedad(lotes, [], 5);
  const varsCultivo = variedades.filter((v) => v.activo === 'SI' && matchCultivo(v.variedad));
  
  // Promedio de ciclos reales de las variedades de este cultivo
  let diasProm = 0;
  let countVars = 0;
  for (const v of varsCultivo) {
    const real = ciclosMap.get(v.variedad);
    if (real && real > 0) { diasProm += real; countVars++; }
  }
  if (countVars === 0) {
    // Fallback: valor de Variedades, o 78d lechuga / 30d rúcula
    diasProm = varsCultivo.length > 0
      ? varsCultivo.reduce((acc, v) => acc + (Number(v.dias_estimados_cosecha) || (cultivo === 'rucula' ? 30 : 78)), 0) / varsCultivo.length
      : (cultivo === 'rucula' ? 30 : 78);
  } else {
    diasProm = diasProm / countVars;
  }
  const semanasCosecha = Math.ceil(diasProm / 7);

  const barras = Array.from(mapa.values()).sort((a, b) => a.semana - b.semana);
  return { barras, semanasCosecha };
}

function safeParseDate2(s: any): Date | null {
  if (!s) return null;
  const str = String(s).trim().split(/[\sT]/)[0];
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
  cosechadoMesAntProporcional: number;
  variacionPct: number | null;
  proyectadoEstaSemana: number;      // próximos 7 días (en plantas para lechuga, paquetes para rúcula)
  proyectadoEstaSemanaPlantas: number; // siempre en plantas
  proyectadoRestoMes: number;
  proyectadoMesTotal: number;
  plantasPorPaquete: number;          // factor de conversión rúcula (default 3)
}

export function resumenCosechaPorCultivo(
  lotes: Lote[],
  variedades: import('./types').Variedad[],
  movimientos: import('./types').Movimiento[] = []
): ResumenCosechaCultivo[] {
  const hoy = new Date();
  const diaHoy = hoy.getDate();
  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();

  const inicioMesActual = new Date(anioActual, mesActual, 1);
  const finMesActual = new Date(anioActual, mesActual + 1, 0, 23, 59, 59);

  // Mes anterior proporcional: solo hasta el mismo día del mes anterior
  const mesPrevio = new Date(anioActual, mesActual - 1, 1);
  const finPropMesPrevio = new Date(anioActual, mesActual - 1, diaHoy, 23, 59, 59);

  // Próximos 7 días y fin de semana para "esta semana"
  const enSemana = new Date(hoy); enSemana.setDate(hoy.getDate() + 7);

  function matchCultivo(variedad: string, cultivo: 'lechuga' | 'rucula'): boolean {
    const v = String(variedad || '').toLowerCase();
    if (cultivo === 'rucula') return v.includes('rucula') || v.includes('rúcula');
    return !v.includes('rucula') && !v.includes('rúcula') && !v.includes('albahaca');
  }

  // Calcular promedios reales de F2 y ciclo total por variedad (de cosechados)
  const promedioF2: Map<string, number> = new Map();
  const promedioCicloTotal: Map<string, number> = new Map();

  function normV(s: string) { return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

  const cosechadosTodos = lotes.filter(l => l.estado === 'cosechado');
  const varNorms = Array.from(new Set(cosechadosTodos.map(l => normV(l.variedad))));

  for (const vn of varNorms) {
    const grupo = cosechadosTodos
      .filter(l => normV(l.variedad) === vn)
      .sort((a, b) => String(b.fecha_cosecha||'').localeCompare(String(a.fecha_cosecha||'')))
      .slice(0, 5);

    const f2vals = grupo.map(l => Number(l.dias_f2)||0).filter(d => d >= 5);
    const totvals = grupo.map(l => Number(l.dias_total)||0).filter(d => d >= 20);

    if (f2vals.length > 0) {
      const prom = Math.round(f2vals.reduce((a,b)=>a+b,0)/f2vals.length);
      for (const l of grupo) { promedioF2.set(l.variedad, prom); }
      promedioF2.set(vn, prom);
    }
    if (totvals.length > 0) {
      const prom = Math.round(totvals.reduce((a,b)=>a+b,0)/totvals.length);
      for (const l of grupo) { promedioCicloTotal.set(l.variedad, prom); }
      promedioCicloTotal.set(vn, prom);
    }
  }

  function getF2dias(variedad: string): number {
    const vn = normV(variedad);
    return promedioF2.get(variedad) ?? promedioF2.get(vn) ?? 30;
  }
  function getCicloDias(variedad: string): number {
    const vn = normV(variedad);
    const varDef = variedades.find(v => normV(v.variedad) === vn);
    return promedioCicloTotal.get(variedad) ?? promedioCicloTotal.get(vn) ?? (Number(varDef?.dias_estimados_cosecha) || 70);
  }

  function estFechaCosecha(l: Lote): Date | null {
    try {
      if (l.fase_actual === 'fase_2') {
        // F2: usa fecha_f2 + promedio días F2
        const ff2 = safeParseDate(l.fecha_f2);
        if (ff2) {
          const est = new Date(ff2);
          est.setDate(est.getDate() + getF2dias(l.variedad));
          return est;
        }
      }
      // F1 o sin fecha_f2: siembra + ciclo total
      const fs = safeParseDate(l.fecha_siembra);
      if (!fs) return null;
      const est = new Date(fs);
      est.setDate(est.getDate() + getCicloDias(l.variedad));
      return est;
    } catch { return null; }
  }

  const PLANTAS_POR_PAQUETE = 3;

  return (['lechuga', 'rucula'] as const).map((cultivo) => {
    const label = cultivo === 'lechuga' ? 'Lechuga' : 'Rúcula';

    // Cosechado mes actual (hasta hoy)
    const cosechadoMes = lotes
      .filter(l => {
        if (l.estado !== 'cosechado' || !matchCultivo(l.variedad, cultivo)) return false;
        const f = safeParseDate(l.fecha_cosecha || l.fecha_ult_movimiento);
        return f && f >= inicioMesActual && f <= hoy;
      })
      .reduce((acc, l) => acc + (Number(l.unidades_cosechadas)||0), 0);

    // Mes anterior PROPORCIONAL (solo hasta el mismo día del mes)
    const cosechadoMesAntProporcional = lotes
      .filter(l => {
        if (l.estado !== 'cosechado' || !matchCultivo(l.variedad, cultivo)) return false;
        const f = safeParseDate(l.fecha_cosecha || l.fecha_ult_movimiento);
        return f && f >= mesPrevio && f <= finPropMesPrevio;
      })
      .reduce((acc, l) => acc + (Number(l.unidades_cosechadas)||0), 0);

    const variacionPct = cosechadoMesAntProporcional > 0
      ? Math.round(((cosechadoMes - cosechadoMesAntProporcional) / cosechadoMesAntProporcional) * 100)
      : null;

    // Proyectado: lotes activos en F1 o F2 con fecha estimada en el mes
    const lotesActivos = lotes.filter(l =>
      l.estado === 'activo' &&
      (l.fase_actual === 'fase_1' || l.fase_actual === 'fase_2') &&
      matchCultivo(l.variedad, cultivo)
    );

    let proyectadoPlantas7d = 0, proyectadoPlantasResto = 0;
    for (const l of lotesActivos) {
      const est = estFechaCosecha(l);
      if (!est) continue;
      const plantas = Number(l.plantas_estimadas_actual) || 0;
      if (est >= hoy && est <= enSemana) proyectadoPlantas7d += plantas;
      else if (est > enSemana && est <= finMesActual) proyectadoPlantasResto += plantas;
    }

    const convFactor = cultivo === 'rucula' ? PLANTAS_POR_PAQUETE : 1;
    const proyectadoEstaSemana = Math.round(proyectadoPlantas7d / convFactor);
    const proyectadoRestoMes = Math.round(proyectadoPlantasResto / convFactor);
    const proyectadoMesTotal = proyectadoEstaSemana + proyectadoRestoMes;

    return {
      cultivo, label, cosechadoMes, cosechadoMesAntProporcional, variacionPct,
      proyectadoEstaSemana, proyectadoEstaSemanaPlantas: proyectadoPlantas7d,
      proyectadoRestoMes, proyectadoMesTotal, plantasPorPaquete: PLANTAS_POR_PAQUETE,
    };
  });
}


export function cicloRealPorVariedad(
  lotes: Lote[],
  _movimientos: any[] = [],
  ultimos: number = 5
): Map<string, number> {
  const resultado = new Map<string, number>();

  // Normalizar nombre de variedad para matching sin tildes
  function normVar(s: string) {
    return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Agrupar cosechados por variedad normalizada
  const cosechadosTodos = lotes.filter(l => l.estado === 'cosechado' && Number(l.dias_total) >= 20);
  const varNorms = Array.from(new Set(cosechadosTodos.map(l => normVar(l.variedad))));

  for (const varNorm of varNorms) {
    const cosechados = cosechadosTodos
      .filter(l => normVar(l.variedad) === varNorm)
      .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')))
      .slice(0, ultimos);

    const dias = cosechados.map(l => Number(l.dias_total)).filter(d => d >= 20);
    if (dias.length === 0) continue;

    const promedio = Math.round(dias.reduce((a, b) => a + b, 0) / dias.length);
    
    // Guardar con el nombre original Y con la variedad normalizada
    // para que el lookup funcione independientemente de tildes
    for (const l of cosechados) {
      resultado.set(l.variedad, promedio);
    }
    // También guardar por nombre normalizado para lookup desde lotes activos
    resultado.set(varNorm, promedio);
  }
  return resultado;
}

// Lookup con normalización de tildes
export function getCicloReal(ciclosReales: Map<string, number>, variedad: string): number | undefined {
  const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ciclosReales.get(variedad) ?? ciclosReales.get(norm(variedad));
}

// === CICLOS POR SEMANA (últimas 8 semanas) ===
export interface CicloSemana {
  semana: string;
  lechugaF1: number;
  lechugaF2: number;
  rucula: number;
  cosechasLechuga: number;
  cosechasRucula: number;
}

export function ciclosPorSemana(lotes: Lote[], movimientos: import('./types').Movimiento[]): CicloSemana[] {
  const hoy = new Date();
  const semanas: CicloSemana[] = [];

  for (let i = 7; i >= 0; i--) {
    const finSemana = new Date(hoy);
    finSemana.setDate(hoy.getDate() - i * 7);
    const inicioSemana = new Date(finSemana);
    inicioSemana.setDate(finSemana.getDate() - 7);

    const label = i === 0 ? 'Esta sem.' : `S-${i}`;

    const cosechadosSemana = lotes.filter((l) => {
      if (l.estado !== 'cosechado') return false;
      const f = safeParseDate(l.fecha_cosecha);
      return f && f > inicioSemana && f <= finSemana;
    });

    // Promedios de dias F1, F2, total para lechuga y rúcula
    const lechuga = cosechadosSemana.filter((l) => {
      const v = String(l.variedad || '').toLowerCase();
      return !v.includes('rucula') && !v.includes('rúcula');
    });
    const ruculaLotes = cosechadosSemana.filter((l) => {
      const v = String(l.variedad || '').toLowerCase();
      return v.includes('rucula') || v.includes('rúcula');
    });

    function promF1(arr: Lote[]) {
      const vals = arr.map((l) => { try { return calcularDiasPorFaseSafe(l, movimientos).fase_1; } catch { return null; } }).filter((d): d is number => d !== null && d > 0);
      return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    }
    function promF2(arr: Lote[]) {
      const vals = arr.map((l) => { try { return calcularDiasPorFaseSafe(l, movimientos).fase_2; } catch { return 0; } }).filter(d => d > 0);
      return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    }

    semanas.push({
      semana: label,
      lechugaF1: promF1(lechuga),
      lechugaF2: promF2(lechuga),
      rucula: promF2(ruculaLotes),
      cosechasLechuga: lechuga.length,
      cosechasRucula: ruculaLotes.length,
    });
  }
  return semanas;
}

function calcularDiasPorFaseSafe(lote: Lote, movimientos: import('./types').Movimiento[]) {
  try {
    const ml = movimientos.filter((m) => m && String(m.id_lote) === String(lote.id_lote));
    const siembra = ml.find((m) => m.tipo === 'siembra');
    const af1 = ml.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_1');
    const af2 = ml.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_2');
    const cosecha = ml.find((m) => m.tipo === 'cosecha');
    const fs = String(siembra?.fecha || lote.fecha_siembra || '').split(/[\sT]/)[0];
    const ff1 = af1 ? String(af1.fecha || '').split(/[\sT]/)[0] : null;
    const ff2 = af2 ? String(af2.fecha || '').split(/[\sT]/)[0] : null;
    const fc = String(cosecha?.fecha || lote.fecha_cosecha || '').split(/[\sT]/)[0];
    function diff(a: string, b: string) { try { return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)); } catch { return 0; } }
    const fase_1 = ff1 ? diff(ff1, ff2 || fc) : null;
    const fase_2 = ff2 ? diff(ff2, fc) : 0;
    return { fase_1, fase_2 };
  } catch { return { fase_1: null, fase_2: 0 }; }
}

// Ciclos por mes y año — desglosado en F1 y F2
export interface CicloMesDetalle { total: number; f1: number | null; f2: number; }

export function ciclosPorMesYAnioDetalle(
  lotes: Lote[], movimientos: Movimiento[], anio: number
): Map<string, Map<number, CicloMesDetalle>> {
  const result = new Map<string, Map<number, CicloMesDetalle>>();
  try {
    for (const l of lotes.filter((l) => {
      if (l.estado !== 'cosechado') return false;
      const f = safeParseDate(l.fecha_cosecha); return f && f.getFullYear() === anio;
    })) {
      try {
        const f = safeParseDate(l.fecha_cosecha); if (!f) continue;
        const mes = f.getMonth();
        const dias = calcularDiasPorFase(l, movimientos);
        if (!result.has(l.variedad)) result.set(l.variedad, new Map());
        const mp = result.get(l.variedad)!;
        const prev = mp.get(mes);
        if (prev) {
          mp.set(mes, {
            total: Math.round((prev.total + dias.total) / 2),
            f1: prev.f1 !== null && dias.fase_1 !== null ? Math.round((prev.f1 + dias.fase_1) / 2) : prev.f1 ?? dias.fase_1 ?? null,
            f2: Math.round((prev.f2 + dias.fase_2) / 2),
          });
        } else {
          mp.set(mes, { total: dias.total, f1: dias.fase_1 ?? null, f2: dias.fase_2 });
        }
      } catch {}
    }
  } catch {}
  return result;
}
