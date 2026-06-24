import type { Lote, Ubicacion } from './types';
import { codigoCultivo } from './lotes';

export interface OcupacionMesada { id_ubicacion: string; nombre: string; nave: number; capacidad: number; plantas_vivas: number; ocupacion_pct: number; huecos_libres: number; lotes_count: number; }
export interface OcupacionNave { nave: number; metros_cuadrados: number; capacidad_total: number; tubos_totales: number; tubos_ocupados: number; tubos_libres: number; plantas_vivas: number; densidad_actual: number; densidad_maxima: number; ocupacion_pct: number; }

export function ocupacionPorMesada(ubicaciones: Ubicacion[], lotes: Lote[]): OcupacionMesada[] {
  // Solo lotes en F1 o F2 (excluir plantineras — no ocupan tubos de mesada)
  const enMesadas = lotes.filter((l) => l.estado === 'activo' && (l.fase_actual === 'fase_1' || l.fase_actual === 'fase_2'));
  const activos = enMesadas;
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
  const enMesadas = lotes.filter((l) =>
    l.estado === 'activo' && (l.fase_actual === 'fase_1' || l.fase_actual === 'fase_2')
  );

  function normNombre(s: string) {
    return s.trim().toLowerCase().replace(/^nave\s*\d+\s*-\s*/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  return [1, 2].map((nave) => {
    const mesadas = ubicaciones.filter((u) => Number(u.nave) === nave && u.activo === 'SI' && u.tipo === 'mesada');

    // Usar perfiles_por_modulo directamente (no capacidad_calculada que puede tener fórmulas)
    const tubosTotales = mesadas.reduce((acc, u) => acc + ((Number(u.modulos) || 1) * (Number(u.perfiles_por_modulo) || 0)), 0);

    // Matching flexible con normalización de tildes
    const lotesNave = enMesadas.filter((l) => {
      const ubicNorm = normNombre(String(l.ubicacion_actual || ''));
      return mesadas.some((m) => normNombre(m.nombre) === ubicNorm);
    });

    const plantas = lotesNave.reduce((acc, l) => acc + (Number(l.plantas_estimadas_actual) || 0), 0);
    const tubosOcupados = lotesNave.reduce((acc, l) => acc + (Number(l.tubos_ocupados_actual) || 0), 0);
    const tubosLibres = Math.max(0, tubosTotales - tubosOcupados);
    const m2 = Number(mesadas[0]?.metros_cuadrados) || (nave === 1 ? 500 : 1100);
    const pct = tubosTotales > 0 ? (tubosOcupados / tubosTotales) * 100 : 0;

    return {
      nave, metros_cuadrados: m2,
      capacidad_total: tubosTotales,
      tubos_totales: tubosTotales, tubos_ocupados: tubosOcupados, tubos_libres: tubosLibres,
      plantas_vivas: plantas,
      densidad_actual: m2 > 0 ? Math.round((plantas / m2) * 10) / 10 : 0,
      densidad_maxima: 0,
      ocupacion_pct: Math.round(pct * 10) / 10,
    };
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

export interface OcupacionPlantinera {
  nave: number;
  nombre: string;
  capacidad: number;
  plantines: number;
  ocupacion_pct: number;
  libres: number;
}

export function ocupacionPlantineras(ubicaciones: Ubicacion[], lotes: Lote[]): OcupacionPlantinera[] {
  const enPlantin = lotes.filter((l) => l.estado === 'activo' && l.fase_actual === 'plantin');
  return ubicaciones
    .filter((u) => u.activo === 'SI' && u.tipo === 'plantinera')
    .sort((a, b) => Number(a.orden_visual) - Number(b.orden_visual))
    .map((u) => {
      const lotesAqui = enPlantin.filter((l) => l.ubicacion_actual === u.nombre);
      const plantines = lotesAqui.reduce((acc, l) => acc + (Number(l.plantines_iniciales) || Number(l.plantas_estimadas_actual) || 0), 0);
      const cap = Number(u.capacidad_calculada) || 0;
      const pct = cap > 0 ? (plantines / cap) * 100 : 0;
      return {
        nave: Number(u.nave),
        nombre: u.nombre,
        capacidad: cap,
        plantines,
        ocupacion_pct: Math.round(pct * 10) / 10,
        libres: Math.max(0, cap - plantines),
      };
    });
}

export interface TubosMesada {
  id_ubicacion: string;
  nombre: string;
  nave: number;
  sector_fase: string;
  variedad_asignada: string;
  tubos_totales: number;      // perfiles_por_modulo = total de tubos
  tubos_ocupados: number;     // suma tubos_ocupados_actual de lotes activos
  tubos_libres: number;
  ocupacion_pct: number;
  lotes_count: number;
}

export interface ResumenTubosNave {
  nave: number;
  mesadas: TubosMesada[];
  tubos_totales: number;
  tubos_ocupados: number;
  tubos_libres: number;
  ocupacion_pct: number;
}

export function tubosPorMesada(ubicaciones: Ubicacion[], lotes: Lote[]): ResumenTubosNave[] {
  const activos = lotes.filter((l) => l.estado === 'activo' && (l.fase_actual === 'fase_1' || l.fase_actual === 'fase_2'));

  const mesadas: TubosMesada[] = ubicaciones
    .filter((u) => u.activo === 'SI' && u.tipo === 'mesada')
    .sort((a, b) => Number(a.orden_visual) - Number(b.orden_visual))
    .map((u) => {
            // tubos totales = modulos × perfiles_por_modulo (cuando modulos > 1)
      // Si perfiles_por_modulo ya es el total (modulos=1), da el mismo resultado
      const modulos = Number(u.modulos) || 1;
      const perfilesPorMod = Number(u.perfiles_por_modulo) || 0;
      const tubosTotal = modulos * perfilesPorMod;
      // Matching flexible: normaliza tildes pero preserva F1/F2
      // "Mesada Rucula 1" == "Mesada Rúcula 1" pero "Mesada Lechuga 1 (F1)" != "Mesada Lechuga 1 (F2)"
      function norm(s: string) {
        return s.trim()
          .toLowerCase()
          .replace(/^nave\s*\d+\s*-\s*/, '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      }
      // También intenta sin el sufijo descriptivo entre paréntesis (ej: "(22 orif/tubo)")
      // pero NUNCA quita "(F1)" o "(F2)"
      function normBase(s: string) {
        return norm(s.replace(/\s*\([^F][^)]*\)\s*$/, '').replace(/\s*\(\d[^)]*\)\s*$/, ''));
      }
      const nombreNorm = norm(u.nombre);
      const nombreBaseNorm = normBase(u.nombre);
      const lotesAqui = activos.filter((l) => {
        const ubic = String(l.ubicacion_actual || '');
        return norm(ubic) === nombreNorm || normBase(ubic) === nombreBaseNorm;
      });
      const tubosOcup = lotesAqui.reduce((acc, l) => acc + (Number(l.tubos_ocupados_actual) || 0), 0);
      const pct = tubosTotal > 0 ? Math.round((tubosOcup / tubosTotal) * 100) : 0;
      return {
        id_ubicacion: u.id_ubicacion,
        nombre: u.nombre,
        nave: Number(u.nave),
        sector_fase: String(u.sector_fase),
        variedad_asignada: String(u.variedad_asignada),
        tubos_totales: tubosTotal,
        tubos_ocupados: tubosOcup,
        tubos_libres: Math.max(0, tubosTotal - tubosOcup),
        ocupacion_pct: pct,
        lotes_count: lotesAqui.length,
      };
    });

  return [1, 2].map((nave) => {
    const mesadasNave = mesadas.filter((m) => m.nave === nave);
    const tot = mesadasNave.reduce((a, m) => a + m.tubos_totales, 0);
    const ocu = mesadasNave.reduce((a, m) => a + m.tubos_ocupados, 0);
    return {
      nave,
      mesadas: mesadasNave,
      tubos_totales: tot,
      tubos_ocupados: ocu,
      tubos_libres: Math.max(0, tot - ocu),
      ocupacion_pct: tot > 0 ? Math.round((ocu / tot) * 100) : 0,
    };
  });
}
