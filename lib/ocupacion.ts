import type { Lote, Ubicacion } from './types';
import { codigoCultivo } from './lotes';

export interface OcupacionMesada { id_ubicacion: string; nombre: string; nave: number; capacidad: number; plantas_vivas: number; ocupacion_pct: number; huecos_libres: number; lotes_count: number; }
export interface OcupacionNave { nave: number; metros_cuadrados: number; capacidad_total: number; plantas_vivas: number; densidad_actual: number; densidad_maxima: number; ocupacion_pct: number; }

export function ocupacionPorMesada(ubicaciones: Ubicacion[], lotes: Lote[]): OcupacionMesada[] {
  const activos = lotes.filter((l) => l.estado === 'activo');
  return ubicaciones.filter((u) => u.activo === 'SI' && u.tipo === 'mesada')
    .sort((a, b) => Number(a.orden_visual) - Number(b.orden_visual))
    .map((u) => {
      const enMesada = activos.filter((l) => l.ubicacion_actual === u.nombre);
      const plantas = enMesada.reduce((acc, l) => acc + (Number(l.plantas_estimadas_actual) || 0), 0);
      const cap = Number(u.capacidad_calculada) || 0;
      const pct = cap > 0 ? (plantas / cap) * 100 : 0;
      return { id_ubicacion: u.id_ubicacion, nombre: u.nombre, nave: Number(u.nave), capacidad: cap, plantas_vivas: plantas, ocupacion_pct: Math.round(pct * 10) / 10, huecos_libres: Math.max(0, cap - plantas), lotes_count: enMesada.length };
    });
}

export function ocupacionPorNave(ubicaciones: Ubicacion[], lotes: Lote[]): OcupacionNave[] {
  const activos = lotes.filter((l) => l.estado === 'activo');
  return [1, 2].map((nave) => {
    const ubics = ubicaciones.filter((u) => Number(u.nave) === nave && u.activo === 'SI');
    const cap = ubics.reduce((acc, u) => acc + (Number(u.capacidad_calculada) || 0), 0);
    const plantas = activos.filter((l) => { const u = ubicaciones.find((u) => u.nombre === l.ubicacion_actual); return u && Number(u.nave) === nave; })
      .reduce((acc, l) => acc + (Number(l.plantas_estimadas_actual) || Number(l.plantines_iniciales) || 0), 0);
    const m2 = Number(ubics[0]?.metros_cuadrados) || 0;
    const pct = cap > 0 ? (plantas / cap) * 100 : 0;
    return { nave, metros_cuadrados: m2, capacidad_total: cap, plantas_vivas: plantas, densidad_actual: m2 > 0 ? Math.round((plantas / m2) * 10) / 10 : 0, densidad_maxima: m2 > 0 ? Math.round((cap / m2) * 10) / 10 : 0, ocupacion_pct: Math.round(pct * 10) / 10 };
  });
}

export function nivelOcupacion(pct: number): 'ok' | 'warn' | 'danger' {
  if (pct >= 85) return 'warn'; if (pct < 50) return 'danger'; return 'ok';
}

export interface ProyeccionEntrega { fecha: string; diaSemana: string; lechuga_crespa: number; lechuga_roble: number; rucula_plantas: number; rucula_paquetes_aprox: number; albahaca_plantas: number; albahaca_paquetes_aprox: number; total_plantas: number; }

export function proyectarEntregas(lotes: Lote[], diasPromedio: Map<string, number>, semanasAdelante: number = 2): ProyeccionEntrega[] {
  const hoy = new Date();
  const entregas: ProyeccionEntrega[] = [];
  for (let s = 0; s < semanasAdelante; s++) {
    for (const dia of ['lunes', 'jueves']) {
      const fecha = nextDayOfWeek(hoy, dia, s);
      const p: ProyeccionEntrega = { fecha: fecha.toISOString().split('T')[0], diaSemana: dia, lechuga_crespa: 0, lechuga_roble: 0, rucula_plantas: 0, rucula_paquetes_aprox: 0, albahaca_plantas: 0, albahaca_paquetes_aprox: 0, total_plantas: 0 };
      for (const l of lotes.filter((l) => l.estado === 'activo')) {
        try {
          const dias = diasPromedio.get(l.variedad) || 35;
          const siembra = new Date(l.fecha_siembra);
          const cosEst = new Date(siembra); cosEst.setDate(cosEst.getDate() + dias);
          if (Math.abs((cosEst.getTime() - fecha.getTime()) / 86400000) <= 2) {
            const plantas = Number(l.plantas_estimadas_actual) || Number(l.plantines_iniciales) || 0;
            const v = String(l.variedad).toLowerCase();
            if (v.includes('crespa')) p.lechuga_crespa += plantas;
            else if (v.includes('roble')) p.lechuga_roble += plantas;
            else if (codigoCultivo(l.variedad) === 'R') p.rucula_plantas += plantas;
            else if (codigoCultivo(l.variedad) === 'A') p.albahaca_plantas += plantas;
          }
        } catch { continue; }
      }
      p.rucula_paquetes_aprox = Math.round(p.rucula_plantas / 3);
      p.albahaca_paquetes_aprox = Math.round(p.albahaca_plantas / 2);
      p.total_plantas = p.lechuga_crespa + p.lechuga_roble + p.rucula_plantas + p.albahaca_plantas;
      entregas.push(p);
    }
  }
  return entregas;
}

function nextDayOfWeek(base: Date, day: string, weeks: number): Date {
  const map: Record<string, number> = { lunes: 1, martes: 2, jueves: 4, viernes: 5 };
  const target = map[day] ?? 1;
  const result = new Date(base);
  const cur = result.getDay();
  let diff = target - cur; if (diff <= 0) diff += 7;
  result.setDate(result.getDate() + diff + weeks * 7);
  return result;
}
