// lib/estadisticas.ts
// Cálculos para Estadísticas. Tolerante a datos vacíos.

import type { Lote, Movimiento } from './types';
import { calcularDiasPorFase, codigoCultivo } from './lotes';

function safeParseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  let yyyy = '', mm = '', dd = '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    [yyyy, mm, dd] = str.split('-');
  } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
    [yyyy, mm, dd] = str.split('/');
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    [dd, mm, yyyy] = str.split('/');
  } else {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    return null;
  }
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

function startOfMonthLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonthLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}

export interface EstadisticaMes {
  variedad: string;
  cosechado: number;
  ciclo_promedio: number;
  rendimiento_kg_por_unidad: number;
}

export function estadisticasDelMes(
  lotes: Lote[],
  movimientos: Movimiento[],
  mes: Date
): EstadisticaMes[] {
  try {
    const inicio = startOfMonthLocal(mes);
    const fin = endOfMonthLocal(mes);

    const lotesCosechados = lotes.filter((l) => {
      if (l.estado !== 'cosechado') return false;
      const f = safeParseDate(l.fecha_cosecha);
      if (!f) return false;
      return f >= inicio && f <= fin;
    });

    const variedadesUnicas = Array.from(
      new Set(lotesCosechados.map((l) => l.variedad).filter(Boolean))
    );

    return variedadesUnicas.map((variedad) => {
      const delGrupo = lotesCosechados.filter((l) => l.variedad === variedad);
      const cosechado = delGrupo.reduce(
        (acc, l) => acc + (Number(l.unidades_cosechadas) || 0),
        0
      );
      const ciclos = delGrupo.map((l) => {
        try {
          return calcularDiasPorFase(l, movimientos).total;
        } catch {
          return 0;
        }
      });
      const cicloPromedio =
        ciclos.length > 0
          ? Math.round(ciclos.reduce((a, b) => a + b, 0) / ciclos.length)
          : 0;
      const pesoTotal = delGrupo.reduce(
        (acc, l) => acc + (Number(l.peso_total_estimado_kg) || 0),
        0
      );
      const rendimiento =
        cosechado > 0 ? Math.round((pesoTotal / cosechado) * 1000) / 1000 : 0;

      return {
        variedad,
        cosechado,
        ciclo_promedio: cicloPromedio,
        rendimiento_kg_por_unidad: rendimiento,
      };
    });
  } catch {
    return [];
  }
}

export function ciclosPorMesYAnio(
  lotes: Lote[],
  movimientos: Movimiento[],
  anio: number
): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>();
  try {
    const lotesAnio = lotes.filter((l) => {
      if (l.estado !== 'cosechado') return false;
      const f = safeParseDate(l.fecha_cosecha);
      if (!f) return false;
      return f.getFullYear() === anio;
    });

    for (const l of lotesAnio) {
      try {
        const f = safeParseDate(l.fecha_cosecha);
        if (!f) continue;
        const mes = f.getMonth();
        const dias = calcularDiasPorFase(l, movimientos).total;
        if (!result.has(l.variedad)) result.set(l.variedad, new Map());
        const map = result.get(l.variedad)!;
        const acumulado = map.get(mes) || 0;
        const conteo = (map.get(mes + 100) || 0) + 1;
        map.set(mes, acumulado + dias);
        map.set(mes + 100, conteo);
      } catch {
        continue;
      }
    }

    for (const [variedad, map] of result.entries()) {
      const finalMap = new Map<number, number>();
      for (let mes = 0; mes < 12; mes++) {
        const total = map.get(mes);
        const conteo = map.get(mes + 100);
        if (total && conteo) {
          finalMap.set(mes, Math.round(total / conteo));
        }
      }
      result.set(variedad, finalMap);
    }
  } catch {
    // Si todo falla, devolvemos mapa vacío
  }
  return result;
}

export interface DiasPromedioVariedad {
  variedad: string;
  plantinera: number;
  fase_1: number | null;
  fase_2: number;
  total: number;
  lotes_count: number;
}

export function diasPromedioPorVariedad(
  lotes: Lote[],
  movimientos: Movimiento[],
  ultimosNDias: number = 60
): DiasPromedioVariedad[] {
  try {
    const limite = new Date();
    limite.setDate(limite.getDate() - ultimosNDias);

    const lotesRelevantes = lotes.filter((l) => {
      if (l.estado !== 'cosechado') return false;
      const f = safeParseDate(l.fecha_cosecha);
      if (!f) return false;
      return f >= limite;
    });

    const variedades = Array.from(
      new Set(lotesRelevantes.map((l) => l.variedad).filter(Boolean))
    );

    return variedades.map((variedad) => {
      const delGrupo = lotesRelevantes.filter((l) => l.variedad === variedad);
      const dias = delGrupo.map((l) => {
        try {
          return calcularDiasPorFase(l, movimientos);
        } catch {
          return { plantinera: 0, fase_1: null, fase_2: 0, total: 0, fechas: { siembra: '', fase_1_inicio: null, fase_2_inicio: null, cosecha: null } };
        }
      });
      const promedio = (xs: number[]) =>
        xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
      const plantinera = promedio(dias.map((d) => d.plantinera));
      const fase1List = dias.map((d) => d.fase_1).filter((d): d is number => d !== null);
      const fase1 = fase1List.length > 0 ? promedio(fase1List) : null;
      const fase2 = promedio(dias.map((d) => d.fase_2));
      const total = promedio(dias.map((d) => d.total));
      return {
        variedad,
        plantinera,
        fase_1: fase1,
        fase_2: fase2,
        total,
        lotes_count: delGrupo.length,
      };
    });
  } catch {
    return [];
  }
}

export function mapaDiasPromedio(
  lotes: Lote[],
  movimientos: Movimiento[]
): Map<string, number> {
  const stats = diasPromedioPorVariedad(lotes, movimientos, 90);
  const map = new Map<string, number>();
  for (const s of stats) map.set(s.variedad, s.total);
  return map;
}

export interface CosechaSemana {
  lechuga_crespa: number;
  lechuga_roble: number;
  rucula_paquetes: number;
  albahaca_paquetes: number;
}

export function cosechaSemanaActual(lotes: Lote[]): CosechaSemana {
  const stats: CosechaSemana = {
    lechuga_crespa: 0,
    lechuga_roble: 0,
    rucula_paquetes: 0,
    albahaca_paquetes: 0,
  };
  try {
    const hoy = new Date();
    const inicio = new Date(hoy);
    const dow = inicio.getDay() === 0 ? 7 : inicio.getDay();
    inicio.setDate(hoy.getDate() - dow + 1);
    inicio.setHours(0, 0, 0, 0);

    for (const l of lotes) {
      if (l.estado !== 'cosechado') continue;
      const f = safeParseDate(l.fecha_cosecha);
      if (!f || f < inicio) continue;
      const v = String(l.variedad || '').toLowerCase();
      const unidades = Number(l.unidades_cosechadas) || 0;
      if (v.includes('crespa')) stats.lechuga_crespa += unidades;
      else if (v.includes('roble')) stats.lechuga_roble += unidades;
      else if (codigoCultivo(l.variedad) === 'R') stats.rucula_paquetes += unidades;
      else if (codigoCultivo(l.variedad) === 'A') stats.albahaca_paquetes += unidades;
    }
  } catch {
    // ignore
  }
  return stats;
}

export function cosechadoEsteMes(lotes: Lote[]): { actual: number; pasado: number } {
  let actual = 0;
  let pasado = 0;
  try {
    const hoy = new Date();
    const inicioMesActual = startOfMonthLocal(hoy);
    const mesPasado = new Date(hoy);
    mesPasado.setMonth(mesPasado.getMonth() - 1);
    const inicioMesPasado = startOfMonthLocal(mesPasado);
    const finMesPasado = endOfMonthLocal(mesPasado);

    for (const l of lotes) {
      if (l.estado !== 'cosechado') continue;
      const f = safeParseDate(l.fecha_cosecha);
      if (!f) continue;
      const u = Number(l.unidades_cosechadas) || 0;
      if (f >= inicioMesActual) actual += u;
      else if (f >= inicioMesPasado && f <= finMesPasado) pasado += u;
    }
  } catch {
    // ignore
  }
  return { actual, pasado };
}
