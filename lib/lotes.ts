import { readSheet } from './sheets';
import type { Lote, Movimiento, Ubicacion } from './types';

function safeParseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  let yyyy = '', mm = '', dd = '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) { [yyyy, mm, dd] = str.split('-'); }
  else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) { [yyyy, mm, dd] = str.split('/'); }
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) { [dd, mm, yyyy] = str.split('/'); }
  else { const d = new Date(str); if (!isNaN(d.getTime())) return d; return null; }
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

function safeDiffDays(from: any, to: any): number {
  const f = safeParseDate(from); const t = safeParseDate(to);
  if (!f || !t) return 0;
  return Math.max(0, Math.round((t.getTime() - f.getTime()) / 86400000));
}

function todayISO(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export interface DiasPorFase {
  plantinera: number; fase_1: number | null; fase_2: number; total: number;
  fechas: { siembra: string; fase_1_inicio: string | null; fase_2_inicio: string | null; cosecha: string | null; };
}

export function calcularDiasPorFase(lote: Lote, movimientos: Movimiento[]): DiasPorFase {
  try {
    const movsLote = movimientos.filter((m) => m && m.id_lote === lote.id_lote)
      .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
    const siembra = movsLote.find((m) => m.tipo === 'siembra');
    const aFase1 = movsLote.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_1');
    const aFase2 = movsLote.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_2');
    const cosecha = movsLote.find((m) => m.tipo === 'cosecha');
    const fechaSiembra = String(siembra?.fecha || lote.fecha_siembra || '');
    const fechaFase1 = aFase1 ? String(aFase1.fecha) : null;
    const fechaFase2 = aFase2 ? String(aFase2.fecha) : null;
    const fechaCosecha = cosecha ? String(cosecha.fecha) : String(lote.fecha_cosecha || '') || null;
    const hoy = todayISO();
    const finPlantinera = fechaFase1 || fechaFase2 || fechaCosecha || hoy;
    const diasPlantinera = safeDiffDays(fechaSiembra, finPlantinera);
    let diasFase1: number | null = null;
    if (fechaFase1) diasFase1 = safeDiffDays(fechaFase1, fechaFase2 || fechaCosecha || hoy);
    let diasFase2 = 0;
    if (fechaFase2) diasFase2 = safeDiffDays(fechaFase2, fechaCosecha || hoy);
    const total = safeDiffDays(fechaSiembra, fechaCosecha || hoy);
    return { plantinera: diasPlantinera, fase_1: diasFase1, fase_2: diasFase2, total, fechas: { siembra: fechaSiembra, fase_1_inicio: fechaFase1, fase_2_inicio: fechaFase2, cosecha: fechaCosecha } };
  } catch {
    return { plantinera: 0, fase_1: null, fase_2: 0, total: 0, fechas: { siembra: String(lote.fecha_siembra || ''), fase_1_inicio: null, fase_2_inicio: null, cosecha: null } };
  }
}

export function estimarPlantasActuales(lote: Lote, ubicaciones: Ubicacion[]): number {
  try {
    if (lote.fase_actual === 'plantin') return Number(lote.plantines_iniciales) || 0;
    const ubic = ubicaciones.find((u) => u.nombre === lote.ubicacion_actual);
    if (!ubic) return Number(lote.plantas_estimadas_actual) || 0;
    const tubos = Number(lote.tubos_ocupados_actual) || 0;
    const orif = Number(ubic.orificios_por_perfil) || 0;
    if (tubos > 0 && orif > 0) return tubos * orif;
    return Number(lote.plantas_estimadas_actual) || 0;
  } catch { return 0; }
}

export function codigoCultivo(variedad: any): 'L' | 'R' | 'A' {
  const v = String(variedad || '').toLowerCase();
  if (v.includes('rucula') || v.includes('rúcula')) return 'R';
  if (v.includes('albahaca')) return 'A';
  return 'L';
}

export function claseVariedad(lote: Lote): string {
  const v = String(lote.variedad || '').toLowerCase();
  if (v.includes('albahaca')) return 'v-albahaca';
  if (v.includes('rucula') || v.includes('rúcula')) return lote.destino_cosecha === 'bandeja' ? 'v-rucula-bandeja' : 'v-rucula';
  return 'v-lechuga';
}

export function naveDeLote(idLote: string): 1 | 2 | null {
  const m = /^N([12])/.exec(String(idLote || ''));
  if (!m) return null;
  return Number(m[1]) as 1 | 2;
}

export async function proximoIdMovimiento(): Promise<number> {
  const movimientos = await readSheet<Movimiento>('Movimientos');
  if (movimientos.length === 0) return 1;
  return movimientos.reduce((acc, m) => Math.max(acc, Number(m.id_movimiento) || 0), 0) + 1;
}

export type FiltroCultivo = 'todos' | 'lechuga' | 'rucula' | 'albahaca';
export type FiltroFase = 'todas' | 'plantinera' | 'fase_1' | 'fase_2' | 'cosechados';
export type FiltroNave = 'todas' | '1' | '2';
export type FiltroMesada = string; // nombre de mesada o 'todas'
// Alias para compatibilidad
export type FiltroCultivos = FiltroCultivo;

export function aplicarFiltros3(lotes: Lote[], cultivo: FiltroCultivo, fase: FiltroFase, nave: FiltroNave, mesada: FiltroMesada = 'todas'): Lote[] {
  let base = fase === 'cosechados'
    ? lotes.filter((l) => l.estado === 'cosechado')
    : lotes.filter((l) => l.estado === 'activo');
  if (nave !== 'todas') {
    const n = Number(nave);
    base = base.filter((l) => {
      const ubic = String(l.ubicacion_actual || '');
      if (ubic.toLowerCase().includes('nave 1')) return n === 1;
      if (ubic.toLowerCase().includes('nave 2')) return n === 2;
      return naveDeLote(l.id_lote) === n;
    });
  }
  if (cultivo !== 'todos') {
    const cod = cultivo === 'lechuga' ? 'L' : cultivo === 'rucula' ? 'R' : 'A';
    base = base.filter((l) => codigoCultivo(l.variedad) === cod);
  }
  if (fase === 'plantinera') base = base.filter((l) => l.fase_actual === 'plantin');
  else if (fase === 'fase_1') base = base.filter((l) => l.fase_actual === 'fase_1');
  else if (fase === 'fase_2') base = base.filter((l) => l.fase_actual === 'fase_2');
  // Filtro de mesada: normaliza tildes para comparación
  if (mesada && mesada !== 'todas') {
    function normM(s: string) {
      return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    const mesadaNorm = normM(mesada);
    base = base.filter((l) => normM(String(l.ubicacion_actual || '')) === mesadaNorm);
  }
  return base;
}

export function aplicarFiltros(lotes: Lote[], filtro: FiltroCultivos, nave: FiltroNave): Lote[] {
  return aplicarFiltros3(lotes, 'todos', 'todas', nave);
}

export interface ConteosFiltros { todos: number; lechuga: number; rucula: number; albahaca: number; plantinera: number; fase_1: number; fase_2: number; cosechados: number; }

export function contarPorFiltro(lotes: Lote[], nave: FiltroNave): ConteosFiltros {
  let base = lotes;
  if (nave !== 'todas') { const n = Number(nave); base = base.filter((l) => naveDeLote(l.id_lote) === n); }
  const activos = base.filter((l) => l.estado === 'activo');
  const cont: ConteosFiltros = { todos: activos.length, lechuga: 0, rucula: 0, albahaca: 0, plantinera: 0, fase_1: 0, fase_2: 0, cosechados: base.filter((l) => l.estado === 'cosechado').length };
  for (const l of activos) {
    const c = codigoCultivo(l.variedad);
    if (c === 'L') cont.lechuga++; else if (c === 'R') cont.rucula++; else if (c === 'A') cont.albahaca++;
    if (l.fase_actual === 'plantin') cont.plantinera++;
    else if (l.fase_actual === 'fase_1') cont.fase_1++;
    else if (l.fase_actual === 'fase_2') cont.fase_2++;
  }
  return cont;
}

export function calcularDesvioCosecha(cosechadas: number, esperadas: number): { desvio: number; nivel: 'verde' | 'amarillo' | 'rojo' } {
  if (esperadas <= 0) return { desvio: 0, nivel: 'verde' };
  const desvio = Math.abs(((esperadas - cosechadas) / esperadas) * 100);
  return { desvio: Math.round(desvio * 10) / 10, nivel: desvio > 15 ? 'rojo' : desvio > 5 ? 'amarillo' : 'verde' };
}
