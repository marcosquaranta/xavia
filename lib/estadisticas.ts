// lib/estadisticas.ts
// Cálculos para la pantalla de Estadísticas.

import type { Lote, Movimiento } from './types';
import { calcularDiasPorFase, codigoCultivo } from './lotes';
import { differenceInDays, parseISO, startOfMonth, format } from 'date-fns';

export interface EstadisticaMes {
  variedad: string;
  cosechado: number;
  ciclo_promedio: number;
  rendimiento_kg_por_unidad: number;
}

/**
 * Calcula estadísticas mensuales de cosechas por variedad.
 */
export function estadisticasDelMes(
  lotes: Lote[],
  movimientos: Movimiento[],
  mes: Date
): EstadisticaMes[] {
  const inicio = startOfMonth(mes);
  const finMes = new Date(inicio);
  finMes.setMonth(finMes.getMonth() + 1);
  finMes.setDate(0);

  const lotesCosechados = lotes.filter(
    (l) =>
      l.estado === 'cosechado' &&
      l.fecha_cosecha &&
      parseISO(l.fecha_cosecha) >= inicio &&
      parseISO(l.fecha_cosecha) <= finMes
  );

  const variedadesUnicas = Array.from(
    new Set(lotesCosechados.map((l) => l.variedad))
  );

  return variedadesUnicas.map((variedad) => {
    const delGrupo = lotesCosechados.filter((l) => l.variedad === variedad);
    const cosechado = delGrupo.reduce(
      (acc, l) => acc + (Number(l.unidades_cosechadas) || 0),
      0
    );
    const ciclos = delGrupo.map(
      (l) => calcularDiasPorFase(l, movimientos).total
    );
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
}

/**
 * Días promedio de ciclo total por variedad en cada mes del año.
 * Devuelve: { variedad: { mes: dias_promedio } }
 */
export function ciclosPorMesYAnio(
  lotes: Lote[],
  movimientos: Movimiento[],
  anio: number
): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>();

  const lotesAnio = lotes.filter((l) => {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) return false;
    try {
      return parseISO(l.fecha_cosecha).getFullYear() === anio;
    } catch {
      return false;
    }
  });

  for (const l of lotesAnio) {
    try {
      const mes = parseISO(l.fecha_cosecha).getMonth();
      const dias = calcularDiasPorFase(l, movimientos).total;
      if (!result.has(l.variedad)) result.set(l.variedad, new Map());
      const map = result.get(l.variedad)!;
      const acumulado = map.get(mes) || 0;
      const conteo = (map.get(mes + 100) || 0) + 1; // contador en clave +100
      map.set(mes, acumulado + dias);
      map.set(mes + 100, conteo);
    } catch {
      continue;
    }
  }

  // Convertir a promedios
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

  return result;
}

/**
 * Días promedio por fase para cada variedad (últimos N días).
 */
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
  const limite = new Date();
  limite.setDate(limite.getDate() - ultimosNDias);

  const lotesRelevantes = lotes.filter((l) => {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) return false;
    try {
      return parseISO(l.fecha_cosecha) >= limite;
    } catch {
      return false;
    }
  });

  const variedades = Array.from(new Set(lotesRelevantes.map((l) => l.variedad)));

  return variedades.map((variedad) => {
    const delGrupo = lotesRelevantes.filter((l) => l.variedad === variedad);
    const dias = delGrupo.map((l) => calcularDiasPorFase(l, movimientos));
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
}

/**
 * Mapa: variedad → días promedio totales (para usar en proyecciones).
 */
export function mapaDiasPromedio(
  lotes: Lote[],
  movimientos: Movimiento[]
): Map<string, number> {
  const stats = diasPromedioPorVariedad(lotes, movimientos, 90);
  const map = new Map<string, number>();
  for (const s of stats) {
    map.set(s.variedad, s.total);
  }
  return map;
}

/**
 * Stats para el Panel principal: cosecha de la semana actual desglosada.
 */
export interface CosechaSemana {
  lechuga_crespa: number;
  lechuga_roble: number;
  rucula_paquetes: number;
  albahaca_paquetes: number;
}

export function cosechaSemanaActual(lotes: Lote[]): CosechaSemana {
  const hoy = new Date();
  const inicio = new Date(hoy);
  inicio.setDate(hoy.getDate() - hoy.getDay() + 1); // Lunes
  inicio.setHours(0, 0, 0, 0);

  const lotesEsta = lotes.filter((l) => {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) return false;
    try {
      return parseISO(l.fecha_cosecha) >= inicio;
    } catch {
      return false;
    }
  });

  const stats: CosechaSemana = {
    lechuga_crespa: 0,
    lechuga_roble: 0,
    rucula_paquetes: 0,
    albahaca_paquetes: 0,
  };

  for (const l of lotesEsta) {
    const v = l.variedad.toLowerCase();
    const unidades = Number(l.unidades_cosechadas) || 0;
    if (v.includes('crespa')) stats.lechuga_crespa += unidades;
    else if (v.includes('roble')) stats.lechuga_roble += unidades;
    else if (codigoCultivo(l.variedad) === 'R') stats.rucula_paquetes += unidades;
    else if (codigoCultivo(l.variedad) === 'A') stats.albahaca_paquetes += unidades;
  }
  return stats;
}

export function cosechadoEsteMes(lotes: Lote[]): { actual: number; pasado: number } {
  const hoy = new Date();
  const inicioMesActual = startOfMonth(hoy);
  const mesPasado = new Date(hoy);
  mesPasado.setMonth(mesPasado.getMonth() - 1);
  const inicioMesPasado = startOfMonth(mesPasado);
  const finMesPasado = new Date(inicioMesActual);
  finMesPasado.setDate(0);

  let actual = 0;
  let pasado = 0;

  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) continue;
    try {
      const f = parseISO(l.fecha_cosecha);
      const u = Number(l.unidades_cosechadas) || 0;
      if (f >= inicioMesActual) actual += u;
      else if (f >= inicioMesPasado && f <= finMesPasado) pasado += u;
    } catch {
      continue;
    }
  }

  return { actual, pasado };
}
