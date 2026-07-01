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
    const fechaFase1 = aFase1 ? String(aFase1.fecha) : (lote.fecha_f1 ? String(lote.fecha_f1) : null);
    const fechaFase2 = aFase2 ? String(aFase2.fecha) : (lote.fecha_f2 ? String(lote.fecha_f2) : null);
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

function normUbic(s: string) {
  return String(s || '').trim().toLowerCase().replace(/^nave\s*\d+\s*-\s*/, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Mapa: nombre de mesada/plantinera normalizado → nave.
// OJO: muchas mesadas tienen el mismo nombre base en ambas naves (ej. "Mesada Rúcula 1").
// En ese caso el nombre es ambiguo y NO se incluye en el mapa (se resuelve por otro lado).
export function mapaMesadaNave(ubicaciones: Ubicacion[]): Map<string, number> {
  const naves = new Map<string, Set<number>>();
  for (const u of ubicaciones) {
    if (u.tipo === 'mesada' || u.tipo === 'plantinera') {
      const k = normUbic(u.nombre);
      if (!naves.has(k)) naves.set(k, new Set());
      naves.get(k)!.add(Number(u.nave));
    }
  }
  const m = new Map<string, number>();
  for (const [k, set] of naves) if (set.size === 1) m.set(k, [...set][0]);
  return m;
}

// Nave REAL del lote: prioriza su ubicación actual (mesada) sobre el prefijo del ID,
// que queda obsoleto si el lote se trasplantó de una nave a otra.
export function naveRealDeLote(l: Lote, mesadaNave?: Map<string, number>): 1 | 2 | null {
  const ubic = String(l.ubicacion_actual || '');
  const ubicL = ubic.toLowerCase();
  if (ubicL.includes('nave 1')) return 1;
  if (ubicL.includes('nave 2')) return 2;
  if (mesadaNave) {
    const n = mesadaNave.get(normUbic(ubic));
    if (n === 1 || n === 2) return n;
  }
  return naveDeLote(l.id_lote);
}

export type FiltroCultivo = 'todos' | 'lechuga' | 'rucula' | 'albahaca';
export type FiltroFase = 'todas' | 'plantinera' | 'fase_1' | 'fase_2' | 'cosechados';
export type FiltroNave = 'todas' | '1' | '2';
export type FiltroMesada = string; // nombre de mesada o 'todas'
export type FiltroTiempo = 'todos' | '7d' | '30d' | '90d'; // para cosechados
// Alias para compatibilidad
export type FiltroCultivos = FiltroCultivo;

export function aplicarFiltros3(lotes: Lote[], cultivo: FiltroCultivo, fase: FiltroFase, nave: FiltroNave, mesada: FiltroMesada = 'todas', tiempo: FiltroTiempo = 'todos', ubicaciones?: Ubicacion[]): Lote[] {
  const mesadaNave = ubicaciones ? mapaMesadaNave(ubicaciones) : undefined;
  let base = fase === 'cosechados'
    ? lotes.filter((l) => l.estado === 'cosechado')
    : lotes.filter((l) => l.estado === 'activo');
  if (nave !== 'todas') {
    const n = Number(nave);
    base = base.filter((l) => naveRealDeLote(l, mesadaNave) === n);
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
      return s.trim().toLowerCase().replace(/^nave\s*\d+\s*-\s*/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    const mesadaNorm = normM(mesada);
    base = base.filter((l) => normM(String(l.ubicacion_actual || '')) === mesadaNorm);
  }
  // Filtro de tiempo — solo aplica a cosechados
  if (tiempo !== 'todos' && fase === 'cosechados') {
    const hoy = new Date();
    const dias = tiempo === '7d' ? 7 : tiempo === '30d' ? 30 : 90;
    const limite = new Date(hoy); limite.setDate(hoy.getDate() - dias);
    base = base.filter((l) => {
      const f = l.fecha_ult_movimiento || l.fecha_cosecha;
      if (!f) return false;
      try { return new Date(String(f).split(/[\sT]/)[0]) >= limite; } catch { return false; }
    });
  }
  return base;
}

export function aplicarFiltros(lotes: Lote[], filtro: FiltroCultivos, nave: FiltroNave): Lote[] {
  return aplicarFiltros3(lotes, 'todos', 'todas', nave);
}

export interface ConteosFiltros { todos: number; lechuga: number; rucula: number; albahaca: number; plantinera: number; fase_1: number; fase_2: number; cosechados: number; }

export function contarPorFiltro(lotes: Lote[], nave: FiltroNave, ubicaciones?: Ubicacion[]): ConteosFiltros {
  const mesadaNave = ubicaciones ? mapaMesadaNave(ubicaciones) : undefined;
  let base = lotes;
  if (nave !== 'todas') {
    const n = Number(nave);
    base = base.filter((l) => naveRealDeLote(l, mesadaNave) === n);
  }
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
