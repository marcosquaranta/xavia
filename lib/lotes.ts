// lib/lotes.ts
// Lógica de negocio relacionada con lotes y movimientos.

import { readSheet, appendRow, updateRow, readConfig, updateConfig } from './sheets';
import type { Lote, Movimiento, Variedad, Ubicacion, Fase } from './types';
import { differenceInDays, parseISO, format } from 'date-fns';

/**
 * Calcula los días que un lote estuvo (o lleva) en cada fase de su ciclo.
 * Lee los movimientos del lote y mide los rangos.
 */
export interface DiasPorFase {
  plantinera: number;
  fase_1: number | null; // null si la variedad salta F1
  fase_2: number;
  total: number;
  fechas: {
    siembra: string;
    fase_1_inicio: string | null;
    fase_2_inicio: string | null;
    cosecha: string | null;
  };
}

export function calcularDiasPorFase(
  lote: Lote,
  movimientos: Movimiento[]
): DiasPorFase {
  const movsLote = movimientos
    .filter((m) => m.id_lote === lote.id_lote)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const siembra = movsLote.find((m) => m.tipo === 'siembra');
  const aFase1 = movsLote.find(
    (m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_1'
  );
  const aFase2 = movsLote.find(
    (m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_2'
  );
  const cosecha = movsLote.find((m) => m.tipo === 'cosecha');

  const fechaSiembra = siembra?.fecha || lote.fecha_siembra;
  const fechaFase1 = aFase1?.fecha || null;
  const fechaFase2 = aFase2?.fecha || null;
  const fechaCosecha = cosecha?.fecha || lote.fecha_cosecha || null;
  const hoy = format(new Date(), 'yyyy-MM-dd');

  // Plantinera: desde siembra hasta primer trasplante (o hoy si sigue ahí)
  const finPlantinera = fechaFase1 || fechaFase2 || fechaCosecha || hoy;
  const diasPlantinera = diffDays(fechaSiembra, finPlantinera);

  // Fase 1: solo aplica si el lote pasó por F1
  let diasFase1: number | null = null;
  if (fechaFase1) {
    const finF1 = fechaFase2 || fechaCosecha || hoy;
    diasFase1 = diffDays(fechaFase1, finF1);
  }

  // Fase 2
  let diasFase2 = 0;
  if (fechaFase2) {
    const finF2 = fechaCosecha || hoy;
    diasFase2 = diffDays(fechaFase2, finF2);
  } else if (lote.fase_actual === 'fase_2' && !fechaFase2) {
    // Por si el lote está en fase_2 pero no hay movimiento explícito (caso raro)
    diasFase2 = diffDays(lote.fecha_ult_movimiento || fechaSiembra, fechaCosecha || hoy);
  }

  const finCiclo = fechaCosecha || hoy;
  const total = diffDays(fechaSiembra, finCiclo);

  return {
    plantinera: diasPlantinera,
    fase_1: diasFase1,
    fase_2: diasFase2,
    total,
    fechas: {
      siembra: fechaSiembra,
      fase_1_inicio: fechaFase1,
      fase_2_inicio: fechaFase2,
      cosecha: fechaCosecha,
    },
  };
}

function diffDays(from: string, to: string): number {
  try {
    return Math.max(0, differenceInDays(parseISO(to), parseISO(from)));
  } catch {
    return 0;
  }
}

/**
 * Estima cuántas plantas hay en el lote ahora mismo según los tubos ocupados
 * y los orificios por perfil de la ubicación.
 */
export function estimarPlantasActuales(
  lote: Lote,
  ubicaciones: Ubicacion[]
): number {
  if (lote.fase_actual === 'plantin') {
    return Number(lote.plantines_iniciales) || 0;
  }
  const ubic = ubicaciones.find((u) => u.nombre === lote.ubicacion_actual);
  if (!ubic) return Number(lote.plantas_estimadas_actual) || 0;
  const tubos = Number(lote.tubos_ocupados_actual) || 0;
  const orificios = Number(ubic.orificios_por_perfil) || 0;
  return tubos * orificios;
}

/**
 * Devuelve el código de cultivo (L/R/A) según la variedad.
 */
export function codigoCultivo(variedad: string): 'L' | 'R' | 'A' {
  const v = variedad.toLowerCase();
  if (v.includes('lechuga') || v.includes('roble')) return 'L';
  if (v.includes('rucula') || v.includes('rúcula')) return 'R';
  if (v.includes('albahaca')) return 'A';
  return 'L';
}

/**
 * Devuelve la clase CSS que corresponde al lote según su variedad.
 */
export function claseVariedad(lote: Lote): string {
  const v = lote.variedad.toLowerCase();
  if (v.includes('albahaca')) return 'v-albahaca';
  if (v.includes('rucula') || v.includes('rúcula')) {
    if (lote.destino_cosecha === 'bandeja') return 'v-rucula-bandeja';
    return 'v-rucula';
  }
  return 'v-lechuga';
}

/**
 * Genera el próximo id_movimiento (autoincremental).
 */
export async function proximoIdMovimiento(): Promise<number> {
  const movimientos = await readSheet<Movimiento>('Movimientos');
  if (movimientos.length === 0) return 1;
  const max = movimientos.reduce(
    (acc, m) => Math.max(acc, Number(m.id_movimiento) || 0),
    0
  );
  return max + 1;
}

/**
 * Filtros para Mis Cultivos.
 */
export type FiltroCultivos =
  | 'todos'
  | 'lechugas-f2'
  | 'lechugas-f1'
  | 'lechugas-plantin'
  | 'rucula-f2'
  | 'rucula-plantin'
  | 'albahaca'
  | 'cosechados';

export function aplicarFiltroCultivos(
  lotes: Lote[],
  filtro: FiltroCultivos
): Lote[] {
  if (filtro === 'cosechados') {
    return lotes.filter((l) => l.estado === 'cosechado');
  }
  const activos = lotes.filter((l) => l.estado === 'activo');
  if (filtro === 'todos') return activos;

  return activos.filter((l) => {
    const codigo = codigoCultivo(l.variedad);
    const fase = l.fase_actual;
    if (filtro === 'lechugas-f2') return codigo === 'L' && fase === 'fase_2';
    if (filtro === 'lechugas-f1') return codigo === 'L' && fase === 'fase_1';
    if (filtro === 'lechugas-plantin') return codigo === 'L' && fase === 'plantin';
    if (filtro === 'rucula-f2') return codigo === 'R' && fase === 'fase_2';
    if (filtro === 'rucula-plantin') return codigo === 'R' && fase === 'plantin';
    if (filtro === 'albahaca') return codigo === 'A';
    return true;
  });
}

/**
 * Cuenta cuántos lotes activos hay en cada filtro (para los badges).
 */
export function contarPorFiltro(lotes: Lote[]): Record<FiltroCultivos, number> {
  const activos = lotes.filter((l) => l.estado === 'activo');
  const cont: Record<FiltroCultivos, number> = {
    todos: activos.length,
    'lechugas-f2': 0,
    'lechugas-f1': 0,
    'lechugas-plantin': 0,
    'rucula-f2': 0,
    'rucula-plantin': 0,
    albahaca: 0,
    cosechados: lotes.filter((l) => l.estado === 'cosechado').length,
  };
  for (const l of activos) {
    const codigo = codigoCultivo(l.variedad);
    if (codigo === 'A') cont.albahaca++;
    else if (codigo === 'L') {
      if (l.fase_actual === 'fase_2') cont['lechugas-f2']++;
      else if (l.fase_actual === 'fase_1') cont['lechugas-f1']++;
      else cont['lechugas-plantin']++;
    } else if (codigo === 'R') {
      if (l.fase_actual === 'fase_2') cont['rucula-f2']++;
      else cont['rucula-plantin']++;
    }
  }
  return cont;
}

/**
 * Calcula el desvío porcentual de una cosecha contra el promedio histórico.
 * Se usa para alertas (solo el admin las ve).
 */
export function calcularDesvioCosecha(
  unidadesCosechadas: number,
  unidadesEsperadas: number
): { desvio: number; nivel: 'verde' | 'amarillo' | 'rojo' } {
  if (unidadesEsperadas <= 0) return { desvio: 0, nivel: 'verde' };
  const diff = unidadesEsperadas - unidadesCosechadas;
  const desvio = Math.abs((diff / unidadesEsperadas) * 100);
  let nivel: 'verde' | 'amarillo' | 'rojo' = 'verde';
  if (desvio > 15) nivel = 'rojo';
  else if (desvio > 5) nivel = 'amarillo';
  return { desvio: Math.round(desvio * 10) / 10, nivel };
}
