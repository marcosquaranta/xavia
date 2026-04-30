// lib/ocupacion.ts
// Cálculos de ocupación de mesadas, capacidad, densidad.

import type { Lote, Ubicacion } from './types';
import { codigoCultivo } from './lotes';

export interface OcupacionMesada {
  id_ubicacion: string;
  nombre: string;
  nave: number;
  capacidad: number;
  plantas_vivas: number;
  ocupacion_pct: number;
  huecos_libres: number;
  lotes_count: number;
}

export interface OcupacionNave {
  nave: number;
  metros_cuadrados: number;
  capacidad_total: number;
  plantas_vivas: number;
  densidad_actual: number; // plantas/m²
  densidad_maxima: number;
  ocupacion_pct: number;
}

/**
 * Calcula ocupación por mesada.
 */
export function ocupacionPorMesada(
  ubicaciones: Ubicacion[],
  lotes: Lote[]
): OcupacionMesada[] {
  const lotesActivos = lotes.filter((l) => l.estado === 'activo');

  return ubicaciones
    .filter((u) => u.activo === 'SI' && u.tipo === 'mesada')
    .sort((a, b) => Number(a.orden_visual) - Number(b.orden_visual))
    .map((u) => {
      const lotesEnMesada = lotesActivos.filter(
        (l) => l.ubicacion_actual === u.nombre
      );
      const plantasVivas = lotesEnMesada.reduce(
        (acc, l) => acc + (Number(l.plantas_estimadas_actual) || 0),
        0
      );
      const capacidad = Number(u.capacidad_calculada) || 0;
      const ocupacion = capacidad > 0 ? (plantasVivas / capacidad) * 100 : 0;
      const huecos = Math.max(0, capacidad - plantasVivas);
      return {
        id_ubicacion: u.id_ubicacion,
        nombre: u.nombre,
        nave: Number(u.nave),
        capacidad,
        plantas_vivas: plantasVivas,
        ocupacion_pct: Math.round(ocupacion * 10) / 10,
        huecos_libres: huecos,
        lotes_count: lotesEnMesada.length,
      };
    });
}

/**
 * Calcula ocupación agregada por nave.
 */
export function ocupacionPorNave(
  ubicaciones: Ubicacion[],
  lotes: Lote[]
): OcupacionNave[] {
  const naves = [1, 2];
  const lotesActivos = lotes.filter((l) => l.estado === 'activo');

  return naves.map((nave) => {
    const ubicsNave = ubicaciones.filter(
      (u) => Number(u.nave) === nave && u.activo === 'SI'
    );
    const capacidadTotal = ubicsNave.reduce(
      (acc, u) => acc + (Number(u.capacidad_calculada) || 0),
      0
    );
    const plantasVivas = lotesActivos
      .filter((l) => {
        const ubic = ubicaciones.find((u) => u.nombre === l.ubicacion_actual);
        return ubic && Number(ubic.nave) === nave;
      })
      .reduce(
        (acc, l) =>
          acc + (Number(l.plantas_estimadas_actual) || Number(l.plantines_iniciales) || 0),
        0
      );
    const m2 =
      ubicsNave[0] && Number(ubicsNave[0].metros_cuadrados)
        ? Number(ubicsNave[0].metros_cuadrados)
        : 0;
    const densidadActual = m2 > 0 ? plantasVivas / m2 : 0;
    const densidadMaxima = m2 > 0 ? capacidadTotal / m2 : 0;
    const ocupacion = capacidadTotal > 0 ? (plantasVivas / capacidadTotal) * 100 : 0;

    return {
      nave,
      metros_cuadrados: m2,
      capacidad_total: capacidadTotal,
      plantas_vivas: plantasVivas,
      densidad_actual: Math.round(densidadActual * 10) / 10,
      densidad_maxima: Math.round(densidadMaxima * 10) / 10,
      ocupacion_pct: Math.round(ocupacion * 10) / 10,
    };
  });
}

/**
 * Devuelve un nivel de color (ok/warn/danger) según el porcentaje de ocupación.
 */
export function nivelOcupacion(pct: number): 'ok' | 'warn' | 'danger' {
  if (pct >= 85) return 'warn'; // Lleno: ojo, no entran muchos lotes nuevos
  if (pct < 50) return 'danger'; // Vacío: desperdicio de espacio
  return 'ok';
}

/**
 * Estima cuántas plantas/paquetes/bandejas estarán listos en cada fecha de entrega
 * de las próximas N semanas. Se calcula a partir de los lotes activos y los
 * tiempos promedio recientes por variedad.
 */
export interface ProyeccionEntrega {
  fecha: string; // YYYY-MM-DD
  diaSemana: 'lunes' | 'martes' | 'jueves' | 'viernes';
  lechuga_crespa: number;
  lechuga_roble: number;
  rucula_plantas: number; // total plantas
  rucula_paquetes_aprox: number;
  albahaca_plantas: number;
  albahaca_paquetes_aprox: number;
  total_plantas: number;
}

export function proyectarEntregas(
  lotes: Lote[],
  diasPromedioPorVariedad: Map<string, number>,
  semanasAdelante: number = 4
): ProyeccionEntrega[] {
  const hoy = new Date();
  const entregas: ProyeccionEntrega[] = [];

  for (let s = 0; s < semanasAdelante; s++) {
    for (const dia of ['lunes', 'martes', 'jueves', 'viernes'] as const) {
      const fecha = nextDayOfWeek(hoy, dia, s);
      const proy: ProyeccionEntrega = {
        fecha: fecha.toISOString().split('T')[0],
        diaSemana: dia,
        lechuga_crespa: 0,
        lechuga_roble: 0,
        rucula_plantas: 0,
        rucula_paquetes_aprox: 0,
        albahaca_plantas: 0,
        albahaca_paquetes_aprox: 0,
        total_plantas: 0,
      };

      for (const lote of lotes.filter((l) => l.estado === 'activo')) {
        const cosechaEstimada = estimarFechaCosecha(lote, diasPromedioPorVariedad);
        if (!cosechaEstimada) continue;
        if (mismoBloqueDeEntrega(cosechaEstimada, fecha)) {
          const plantas =
            Number(lote.plantas_estimadas_actual) ||
            Number(lote.plantines_iniciales) ||
            0;
          const codigo = codigoCultivo(lote.variedad);
          if (lote.variedad.toLowerCase().includes('crespa')) {
            proy.lechuga_crespa += plantas;
          } else if (lote.variedad.toLowerCase().includes('roble')) {
            proy.lechuga_roble += plantas;
          } else if (codigo === 'R') {
            proy.rucula_plantas += plantas;
          } else if (codigo === 'A') {
            proy.albahaca_plantas += plantas;
          }
        }
      }

      proy.rucula_paquetes_aprox = Math.round(proy.rucula_plantas / 3);
      proy.albahaca_paquetes_aprox = Math.round(proy.albahaca_plantas / 2);
      proy.total_plantas =
        proy.lechuga_crespa +
        proy.lechuga_roble +
        proy.rucula_plantas +
        proy.albahaca_plantas;

      entregas.push(proy);
    }
  }
  return entregas;
}

function estimarFechaCosecha(
  lote: Lote,
  diasPromedio: Map<string, number>
): Date | null {
  const dias = diasPromedio.get(lote.variedad) || 35;
  try {
    const siembra = new Date(lote.fecha_siembra);
    const cosecha = new Date(siembra);
    cosecha.setDate(cosecha.getDate() + dias);
    return cosecha;
  } catch {
    return null;
  }
}

function nextDayOfWeek(
  base: Date,
  day: 'lunes' | 'martes' | 'jueves' | 'viernes',
  weeksOffset: number
): Date {
  const map = { lunes: 1, martes: 2, jueves: 4, viernes: 5 };
  const target = map[day];
  const result = new Date(base);
  const currentDow = result.getDay();
  let diff = target - currentDow;
  if (diff <= 0) diff += 7;
  result.setDate(result.getDate() + diff + weeksOffset * 7);
  return result;
}

function mismoBloqueDeEntrega(cosecha: Date, fechaEntrega: Date): boolean {
  // Una cosecha cae en una entrega si están dentro de ±2 días
  const diff = Math.abs(
    (cosecha.getTime() - fechaEntrega.getTime()) / (1000 * 60 * 60 * 24)
  );
  return diff <= 2;
}
