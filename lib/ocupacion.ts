import type { Lote, Ubicacion } from './types';
import { codigoCultivo, naveRealDeLote, mapaMesadaNave } from './lotes';

// ── Fecha y hora de Argentina ─────────────────────────────────────────────────────────
// El snapshot diario de ocupación se identifica por fecha calendario, y esa fecha tiene
// que ser la de Argentina, no la de UTC (donde corre el servidor). Entre las 21:00 y las
// 23:59 hora argentina, UTC ya pasó la medianoche y está en el día siguiente — el cron
// que registra este snapshot corre justo a las 21hs ART para capturar el trabajo ya hecho
// del día (ver app/api/ocupacion/registrar), así que un `new Date().toISOString()` común
// etiquetaría esa foto con la fecha de MAÑANA. Mismo criterio que la "regla del mediodía"
// de lib/camara.ts.
export function fechaArgentinaHoy(momento: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(momento);
}
export function horaArgentinaHoy(momento: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }).format(momento));
}

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
  const mesadaNaveMap = mapaMesadaNave(ubicaciones);

  return [1, 2].map((nave) => {
    const mesadas = ubicaciones.filter((u) => Number(u.nave) === nave && u.activo === 'SI' && u.tipo === 'mesada');

    // Usar perfiles_por_modulo directamente (no capacidad_calculada que puede tener fórmulas)
    const tubosTotales = mesadas.reduce((acc, u) => acc + ((Number(u.modulos) || 1) * (Number(u.perfiles_por_modulo) || 0)), 0);

    // Matching flexible con normalización de tildes + chequeo de nave
    // (el nombre de mesada se repite entre naves)
    const lotesNave = enMesadas.filter((l) => {
      const ubicNorm = normNombre(String(l.ubicacion_actual || ''));
      const nombreOk = mesadas.some((m) => normNombre(m.nombre) === ubicNorm);
      return nombreOk && naveRealDeLote(l, mesadaNaveMap) === nave;
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
      // 1 posición = 1 paquete (POSPAQ_ALBAHACA). Antes dividía por 2, que era una
      // suposición de cuando todavía no se producía albahaca.
      p.albahaca_paquetes_aprox = p.albahaca_plantas;
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
  posiciones_totales: number; // tubos_totales × orificios_por_perfil = plantas que entran en total
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
  const mesadaNave = mapaMesadaNave(ubicaciones);

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
      const naveU = Number(u.nave);
      const lotesAqui = activos.filter((l) => {
        const ubic = String(l.ubicacion_actual || '');
        const nombreOk = norm(ubic) === nombreNorm || normBase(ubic) === nombreBaseNorm;
        // El nombre de mesada se repite entre naves → exigir que la nave del lote coincida
        return nombreOk && naveRealDeLote(l, mesadaNave) === naveU;
      });
      const tubosOcup = lotesAqui.reduce((acc, l) => acc + (Number(l.tubos_ocupados_actual) || 0), 0);
      const pct = tubosTotal > 0 ? Math.round((tubosOcup / tubosTotal) * 100) : 0;
      const orificiosPorPerfil = Number(u.orificios_por_perfil) || 0;
      return {
        id_ubicacion: u.id_ubicacion,
        nombre: u.nombre,
        nave: Number(u.nave),
        sector_fase: String(u.sector_fase),
        variedad_asignada: String(u.variedad_asignada),
        tubos_totales: tubosTotal,
        tubos_ocupados: tubosOcup,
        tubos_libres: Math.max(0, tubosTotal - tubosOcup),
        posiciones_totales: tubosTotal * orificiosPorPerfil,
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

// ── Ocupación promedio por nave en los últimos N días, a partir del snapshot diario
// (hoja "OcupacionHistorial" que carga el cron) ── para el análisis mensual: no es la
// ocupación de HOY sino el promedio real del período, ponderado por tubos (no un
// promedio simple de los % de cada mesada, que pesaría igual una mesada chica que una
// grande).
export interface OcupacionHistorialRow { fecha: string; mesada: string; nave: string | number; tubos_totales: string | number; tubos_ocupados: string | number; pct: string | number; }
export function ocupacionPromedioPorNave(rows: OcupacionHistorialRow[], dias = 30): { nave: number; pctPromedio: number; diasConDato: number }[] {
  const hoy = new Date();
  const limite = new Date(hoy); limite.setDate(limite.getDate() - dias);
  const limiteStr = limite.toISOString().split('T')[0];

  const porFechaNave = new Map<string, { tot: number; ocu: number }>();
  for (const r of rows) {
    if (!r.fecha || r.fecha < limiteStr) continue;
    const nave = Number(r.nave);
    const key = `${r.fecha}||${nave}`;
    const cur = porFechaNave.get(key) || { tot: 0, ocu: 0 };
    cur.tot += Number(r.tubos_totales) || 0;
    cur.ocu += Number(r.tubos_ocupados) || 0;
    porFechaNave.set(key, cur);
  }
  const porNave = new Map<number, number[]>();
  for (const [key, { tot, ocu }] of porFechaNave) {
    const nave = Number(key.split('||')[1]);
    const pctDia = tot > 0 ? (ocu / tot) * 100 : 0;
    if (!porNave.has(nave)) porNave.set(nave, []);
    porNave.get(nave)!.push(pctDia);
  }
  return Array.from(porNave.entries())
    .map(([nave, pcts]) => ({
      nave,
      pctPromedio: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0,
      diasConDato: pcts.length,
    }))
    .sort((a, b) => a.nave - b.nave);
}

// ── Mesadas vacías (o sin capacidad) varios días seguidos ────────────────────────────
//
// "mesadasBajas" (más arriba, sobre tubosPorMesada) es la FOTO de hoy: qué está por debajo
// del 90% en este momento. Esto es distinto — es la PELÍCULA de la semana: qué mesada
// estuvo sin una sola planta durante varios días seguidos, que el snapshot de hoy no puede
// mostrar si para cuando se genera el reporte ya se volvió a sembrar.
//
// Cuenta días CALENDARIO, no días hábiles ni de trabajo — un fin de semana entero vacío
// también cuenta, porque la mesada igual no está produciendo esos días.
//
// Dos problemas distintos, no uno:
// - 'vacia': la mesada tiene capacidad (tubos_totales > 0) pero nadie la ocupó. Es un
//   problema de OPERACIÓN — se podría haber trasplantado y no se hizo.
// - 'sin_capacidad': la fila existe con tubos_totales = 0. El cron que la escribe
//   (app/api/ocupacion/registrar) solo anota mesadas con `activo = 'SI'` — una mesada
//   dada de baja ni siquiera genera fila. Que SÍ aparezca y con capacidad en cero es un
//   problema de CONFIGURACIÓN: a esa Ubicación le falta cargar módulos o perfiles por
//   módulo en Admin → Naves. Antes esto se descartaba en silencio por parecer una mesada
//   "apagada a propósito" — no lo es, y tapaba el error en vez de avisarlo.
export interface MesadaVacia { nombre: string; nave: number; diasSeguidos: number; ultimoDiaVacio: string; tipo: 'vacia' | 'sin_capacidad' }

export function mesadasVaciasEnLaSemana(
  historial: OcupacionHistorialRow[], desde: string, hasta: string, umbralDias = 2,
): MesadaVacia[] {
  // Una fila por mesada+día, ordenada por fecha, para poder recorrer y contar las dos
  // rachas por separado (un día nunca es las dos cosas a la vez).
  const porMesada = new Map<string, { nombre: string; nave: number; fecha: string; vacia: boolean; sinCapacidad: boolean }[]>();
  for (const r of historial) {
    const f = String(r.fecha || '').slice(0, 10);
    if (!f || f < desde || f > hasta) continue;
    const tot = Number(r.tubos_totales) || 0;
    const ocu = Number(r.tubos_ocupados) || 0;
    const nombre = String(r.mesada || '').replace(/^Nave \d+ - /, '');
    const key = `${nombre}||${r.nave}`;
    if (!porMesada.has(key)) porMesada.set(key, []);
    porMesada.get(key)!.push({ nombre, nave: Number(r.nave), fecha: f, sinCapacidad: tot <= 0, vacia: tot > 0 && ocu === 0 });
  }

  // La racha más larga de una condición dada, sobre una lista ya ordenada por fecha.
  function mejorRachaDe(filas: { fecha: string }[], cumple: (f: any) => boolean): { dias: number; ultimoDia: string } {
    let racha = 0, mejor = 0, ultimoDia = '';
    for (const f of filas) {
      if (cumple(f)) { racha++; if (racha >= mejor) { mejor = racha; ultimoDia = f.fecha; } }
      else racha = 0;
    }
    return { dias: mejor, ultimoDia };
  }

  const resultado: MesadaVacia[] = [];
  for (const filas of porMesada.values()) {
    filas.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const { nombre, nave } = filas[0];
    const vacia = mejorRachaDe(filas, (f) => f.vacia);
    const sinCap = mejorRachaDe(filas, (f) => f.sinCapacidad);
    if (vacia.dias > umbralDias) resultado.push({ nombre, nave, diasSeguidos: vacia.dias, ultimoDiaVacio: vacia.ultimoDia, tipo: 'vacia' });
    if (sinCap.dias > umbralDias) resultado.push({ nombre, nave, diasSeguidos: sinCap.dias, ultimoDiaVacio: sinCap.ultimoDia, tipo: 'sin_capacidad' });
  }
  return resultado.sort((a, b) => b.diasSeguidos - a.diasSeguidos);
}
