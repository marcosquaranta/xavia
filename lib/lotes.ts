// lib/lotes.ts
// Lógica de negocio relacionada con lotes y movimientos.
// Tolerante a datos vacíos o inválidos del Sheet.

import { readSheet } from './sheets';
import type { Lote, Movimiento, Variedad, Ubicacion, Fase } from './types';

// === Helpers seguros para fechas ===

function safeParseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  // Soporta YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY
  let yyyy = '', mm = '', dd = '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    [yyyy, mm, dd] = str.split('-');
  } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
    [yyyy, mm, dd] = str.split('/');
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    [dd, mm, yyyy] = str.split('/');
  } else {
    // Probar Date.parse como último recurso
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    return null;
  }
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (isNaN(d.getTime())) return null;
  return d;
}

function safeDiffDays(from: any, to: any): number {
  const f = safeParseDate(from);
  const t = safeParseDate(to);
  if (!f || !t) return 0;
  const ms = t.getTime() - f.getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

function todayISO(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// === Cálculos de fases ===

export interface DiasPorFase {
  plantinera: number;
  fase_1: number | null;
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
  try {
    const movsLote = movimientos
      .filter((m) => m && m.id_lote === lote.id_lote)
      .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

    const siembra = movsLote.find((m) => m.tipo === 'siembra');
    const aFase1 = movsLote.find(
      (m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_1'
    );
    const aFase2 = movsLote.find(
      (m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_2'
    );
    const cosecha = movsLote.find((m) => m.tipo === 'cosecha');

    const fechaSiembra = String(siembra?.fecha || lote.fecha_siembra || '');
    const fechaFase1 = aFase1 ? String(aFase1.fecha) : null;
    const fechaFase2 = aFase2 ? String(aFase2.fecha) : null;
    const fechaCosecha = cosecha ? String(cosecha.fecha) : String(lote.fecha_cosecha || '') || null;
    const hoy = todayISO();

    const finPlantinera = fechaFase1 || fechaFase2 || fechaCosecha || hoy;
    const diasPlantinera = safeDiffDays(fechaSiembra, finPlantinera);

    let diasFase1: number | null = null;
    if (fechaFase1) {
      const finF1 = fechaFase2 || fechaCosecha || hoy;
      diasFase1 = safeDiffDays(fechaFase1, finF1);
    }

    let diasFase2 = 0;
    if (fechaFase2) {
      const finF2 = fechaCosecha || hoy;
      diasFase2 = safeDiffDays(fechaFase2, finF2);
    }

    const finCiclo = fechaCosecha || hoy;
    const total = safeDiffDays(fechaSiembra, finCiclo);

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
  } catch {
    return {
      plantinera: 0,
      fase_1: null,
      fase_2: 0,
      total: 0,
      fechas: {
        siembra: String(lote.fecha_siembra || ''),
        fase_1_inicio: null,
        fase_2_inicio: null,
        cosecha: null,
      },
    };
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
  try {
    if (lote.fase_actual === 'plantin') {
      return Number(lote.plantines_iniciales) || 0;
    }
    const ubic = ubicaciones.find((u) => u.nombre === lote.ubicacion_actual);
    if (!ubic) return Number(lote.plantas_estimadas_actual) || 0;
    const tubos = Number(lote.tubos_ocupados_actual) || 0;
    const orificios = Number(ubic.orificios_por_perfil) || 0;
    if (tubos > 0 && orificios > 0) return tubos * orificios;
    return Number(lote.plantas_estimadas_actual) || 0;
  } catch {
    return 0;
  }
}

/**
 * Devuelve el código de cultivo (L/R/A) según la variedad.
 */
export function codigoCultivo(variedad: any): 'L' | 'R' | 'A' {
  const v = String(variedad || '').toLowerCase();
  if (v.includes('lechuga') || v.includes('roble')) return 'L';
  if (v.includes('rucula') || v.includes('rúcula')) return 'R';
  if (v.includes('albahaca')) return 'A';
  return 'L';
}

/**
 * Devuelve la clase CSS que corresponde al lote según su variedad.
 */
export function claseVariedad(lote: Lote): string {
  const v = String(lote.variedad || '').toLowerCase();
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
 * Devuelve la nave de un lote según su id_lote.
 * "N1-007" → 1, "N2L1-014" → 2.
 */
export function naveDeLote(idLote: string): 1 | 2 | null {
  const m = /^N([12])/.exec(String(idLote || ''));
  if (!m) return null;
  return Number(m[1]) as 1 | 2;
}

/**
 * Filtros para Mis Cultivos y Panel.
 */
export type FiltroCultivos =
  | 'todos'
  | 'lechuga'
  | 'rucula'
  | 'albahaca'
  | 'plantinera'
  | 'fase_1'
  | 'fase_2'
  | 'cosechados';

export type FiltroNave = 'todas' | '1' | '2';

export function aplicarFiltros(
  lotes: Lote[],
  filtro: FiltroCultivos,
  nave: FiltroNave
): Lote[] {
  let base: Lote[];
  if (filtro === 'cosechados') {
    base = lotes.filter((l) => l.estado === 'cosechado');
  } else {
    base = lotes.filter((l) => l.estado === 'activo');
  }

  // Filtro por nave
  if (nave !== 'todas') {
    const naveNum = Number(nave);
    base = base.filter((l) => naveDeLote(l.id_lote) === naveNum);
  }

  if (filtro === 'todos' || filtro === 'cosechados') return base;
  if (filtro === 'plantinera') return base.filter((l) => l.fase_actual === 'plantin');
  if (filtro === 'fase_1') return base.filter((l) => l.fase_actual === 'fase_1');
  if (filtro === 'fase_2') return base.filter((l) => l.fase_actual === 'fase_2');
  if (filtro === 'lechuga') return base.filter((l) => codigoCultivo(l.variedad) === 'L');
  if (filtro === 'rucula') return base.filter((l) => codigoCultivo(l.variedad) === 'R');
  if (filtro === 'albahaca') return base.filter((l) => codigoCultivo(l.variedad) === 'A');
  return base;
}

export interface ConteosFiltros {
  todos: number;
  lechuga: number;
  rucula: number;
  albahaca: number;
  plantinera: number;
  fase_1: number;
  fase_2: number;
  cosechados: number;
}

export function contarPorFiltro(lotes: Lote[], nave: FiltroNave): ConteosFiltros {
  let base = lotes;
  if (nave !== 'todas') {
    const naveNum = Number(nave);
    base = base.filter((l) => naveDeLote(l.id_lote) === naveNum);
  }
  const activos = base.filter((l) => l.estado === 'activo');
  const cont: ConteosFiltros = {
    todos: activos.length,
    lechuga: 0,
    rucula: 0,
    albahaca: 0,
    plantinera: 0,
    fase_1: 0,
    fase_2: 0,
    cosechados: base.filter((l) => l.estado === 'cosechado').length,
  };
  for (const l of activos) {
    const codigo = codigoCultivo(l.variedad);
    if (codigo === 'L') cont.lechuga++;
    else if (codigo === 'R') cont.rucula++;
    else if (codigo === 'A') cont.albahaca++;
    if (l.fase_actual === 'plantin') cont.plantinera++;
    else if (l.fase_actual === 'fase_1') cont.fase_1++;
    else if (l.fase_actual === 'fase_2') cont.fase_2++;
  }
  return cont;
}

/**
 * Calcula el desvío porcentual de una cosecha contra el promedio histórico.
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
