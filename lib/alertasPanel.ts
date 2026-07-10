import type { Lote } from './types';

export interface Alerta { tipo: 'error' | 'warn' | 'info'; msg: string; lote?: string; prioridad?: number }

function safeDate(s: any): Date | null {
  try { const str = String(s || '').split(/[\sT]/)[0]; return str ? new Date(str + 'T12:00:00') : null; } catch { return null; }
}

// Alertas de producción del Panel (home) — extraído acá para poder reutilizarlo también
// en el reporte semanal por mail.
export function generarAlertas(lotes: Lote[], tubosMesadas: any[], ciclosRealesMap: Map<string, number>, ocGlobal: number): Alerta[] {
  const hoy = new Date();
  const alertas: Alerta[] = [];

  // Promedio F1 por variedad (para detectar lotes lentos en F1)
  const promedioF1Map = new Map<string, number>();
  const cosechadosConF1 = lotes.filter(l => l.estado === 'cosechado' && Number(l.dias_f1) > 0);
  for (const vNorm of ['lechuga', 'rucula']) {
    const grupo = cosechadosConF1.filter(l => {
      const v = String(l.variedad || '').toLowerCase();
      return vNorm === 'rucula' ? v.includes('rucula') || v.includes('rúcula') : !v.includes('rucula') && !v.includes('rúcula');
    });
    if (grupo.length > 0) {
      const prom = Math.round(grupo.reduce((a, l) => a + Number(l.dias_f1), 0) / grupo.length);
      promedioF1Map.set(vNorm, prom);
    }
  }

  for (const l of lotes.filter(l => l.estado === 'activo')) {
    const diasSiembra = (() => { const f = safeDate(l.fecha_siembra); return f ? Math.round((hoy.getTime() - f.getTime()) / 86400000) : 0; })();
    const diasF2 = (() => { const f = safeDate(l.fecha_f2); return f ? Math.round((hoy.getTime() - f.getTime()) / 86400000) : 0; })();
    const diasF1 = (() => { const f = safeDate(l.fecha_f1); return f && l.fase_actual === 'fase_1' ? Math.round((hoy.getTime() - f.getTime()) / 86400000) : 0; })();
    const varNorm = String(l.variedad || '').toLowerCase();
    const esR = varNorm.includes('rucula') || varNorm.includes('rúcula');
    const cicloEst = ciclosRealesMap.get(l.variedad) || (esR ? 35 : 80);
    const f2Est = esR ? 28 : 40; // días esperados en F2

    // 🔴 Lote pasado en F2 (> ciclo * 130%)
    if (diasSiembra > cicloEst * 1.3 && l.fase_actual === 'fase_2') {
      alertas.push({ tipo: 'error', msg: `Lote ${l.id_lote} lleva ${diasSiembra}d de ${cicloEst}d est. — vencido`, lote: l.id_lote });
    }

    // 🔴 F2 muy extendida (> f2Est * 130%)
    if (l.fase_actual === 'fase_2' && diasF2 > f2Est * 1.3) {
      alertas.push({ tipo: 'error', msg: `${l.id_lote} lleva ${diasF2}d en F2 (est. ${f2Est}d) — revisar`, lote: l.id_lote });
    }

    // 🟡 F1 muy extendida
    const promF1 = promedioF1Map.get(esR ? 'rucula' : 'lechuga') || (esR ? 10 : 20);
    if (l.fase_actual === 'fase_1' && diasF1 > promF1 * 1.5 && diasF1 > 15) {
      alertas.push({ tipo: 'warn', msg: `${l.id_lote} lleva ${diasF1}d en F1 (prom ${promF1}d) — demorado`, lote: l.id_lote });
    }

    // 🟡 Lote en plantinera > 30 días
    if (l.fase_actual === 'plantin' && diasSiembra > 30) {
      alertas.push({ tipo: 'warn', msg: `${l.id_lote} lleva ${diasSiembra}d en plantinera — trasplantar`, lote: l.id_lote });
    }
  }

  // 🟡 Sin siembras en últimos 7 días
  const hace7 = new Date(hoy); hace7.setDate(hoy.getDate() - 7);
  const siembrasRecientes = lotes.filter(l => { const f = safeDate(l.fecha_siembra); return f && f >= hace7; });
  if (siembrasRecientes.length === 0) {
    alertas.push({ tipo: 'warn', msg: 'Sin siembras en los últimos 7 días — posible gap de producción' });
  }

  // 🟡 Ocupación total > 95%
  if (ocGlobal > 95) {
    alertas.push({ tipo: 'warn', msg: `Ocupación global al ${ocGlobal}% — sin espacio para nuevos trasplantes` });
  }

  // 🔵 Mesadas F2 con capacidad > 50% libre (oportunidad)
  for (const nave of tubosMesadas) {
    for (const m of nave.mesadas || []) {
      if (m.sector_fase === 'fase_2' && m.tubos_totales > 10 && m.tubos_libres > m.tubos_totales * 0.5) {
        alertas.push({ tipo: 'info', msg: `${m.nombre.replace(/^Nave \d+ - /, '')} F2 al ${m.ocupacion_pct}% — espacio disponible` });
      }
    }
  }

  // 🔵 Mesadas vacías (prioridad 0 — van primero)
  for (const nave of tubosMesadas) {
    for (const m of nave.mesadas || []) {
      if (m.tubos_totales > 10 && m.tubos_ocupados === 0) {
        alertas.push({ tipo: 'info', msg: `${m.nombre.replace(/^Nave \d+ - /, '')} — vacía`, prioridad: 0 });
      }
    }
  }

  // Ordenar: vacías primero, luego errores, warn, info
  alertas.sort((a, b) => {
    const pa = a.prioridad ?? ({ error: 1, warn: 2, info: 3 } as any)[a.tipo];
    const pb = b.prioridad ?? ({ error: 1, warn: 2, info: 3 } as any)[b.tipo];
    return pa - pb;
  });

  return alertas;
}
