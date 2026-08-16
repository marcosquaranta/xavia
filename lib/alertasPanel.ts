import type { Lote, Articulo, StockMes, Movimiento } from './types';
import { calcularUsoTeorico, type DriversMes } from './usoTeorico';

// categoria 'lote_atraso' = atraso puntual de trasplante/cosecha de un lote — ese detalle
// ya se ve en las secciones "Cosechar"/"Trasplantar" del home (con su propio color por
// tiempo transcurrido), así que el Panel las excluye de "Alertas" para no duplicar.
export interface Alerta { tipo: 'error' | 'warn' | 'info'; msg: string; lote?: string; prioridad?: number; categoria?: 'lote_atraso' | 'general' }

function safeDate(s: any): Date | null {
  try { const str = String(s || '').split(/[\sT]/)[0]; return str ? new Date(str + 'T12:00:00') : null; } catch { return null; }
}

// ── Motivo de alerta de calidad de una cosecha puntual — compartido entre el Panel
// ("Desvíos y calidad de cosecha") y la ficha del lote, para no duplicar los umbrales. ──
export type MotivoAlertaCosecha = 'desvio' | 'descarte' | 'densidad';
export const UMBRAL_DESCARTE_PCT = 0.05;
export function motivoAlertaCosecha(mov: Movimiento, esRucula: boolean): MotivoAlertaCosecha | null {
  if (mov.tipo !== 'cosecha') return null;
  if (mov.nivel_alerta === 'amarillo' || mov.nivel_alerta === 'rojo') return 'desvio';
  const plantasEstMov = Number(mov.plantas_estimadas) || 0;
  if (!esRucula && plantasEstMov > 0 && Number(mov.descarte_calculado) / plantasEstMov > UMBRAL_DESCARTE_PCT) return 'descarte';
  if (esRucula && Number(mov.plantas_por_unidad_real) > 3) return 'densidad';
  return null;
}

// Alertas de producción del Panel (home) — extraído acá para poder reutilizarlo también
// en el reporte semanal por mail.
export function generarAlertas(lotes: Lote[], tubosMesadas: any[], ciclosRealesMap: Map<string, number>, ocGlobal: number): Alerta[] {
  const hoy = new Date();
  const alertas: Alerta[] = [];

  // F1 de la última cosecha por cultivo (para detectar lotes lentos en F1) — se compara
  // contra la cosecha más reciente, no contra un promedio histórico: un promedio de
  // todas las cosechas queda desactualizado y mezcla variedades con ritmos distintos.
  const ultimoF1Map = new Map<string, number>();
  const cosechadosConF1 = lotes.filter(l => l.estado === 'cosechado' && Number(l.dias_f1) > 0);
  for (const vNorm of ['lechuga', 'rucula']) {
    const grupo = cosechadosConF1.filter(l => {
      const v = String(l.variedad || '').toLowerCase();
      return vNorm === 'rucula' ? v.includes('rucula') || v.includes('rúcula') : !v.includes('rucula') && !v.includes('rúcula');
    }).sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')));
    if (grupo.length > 0) ultimoF1Map.set(vNorm, Number(grupo[0].dias_f1));
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
      alertas.push({ tipo: 'error', msg: `Lote ${l.id_lote} lleva ${diasSiembra}d de ${cicloEst}d est. — vencido`, lote: l.id_lote, categoria: 'lote_atraso' });
    }

    // 🔴 F2 muy extendida (> f2Est * 130%)
    if (l.fase_actual === 'fase_2' && diasF2 > f2Est * 1.3) {
      alertas.push({ tipo: 'error', msg: `${l.id_lote} lleva ${diasF2}d en F2 (est. ${f2Est}d) — revisar`, lote: l.id_lote, categoria: 'lote_atraso' });
    }

    // 🟡 F1 muy extendida (vs. la última cosecha de ese cultivo)
    const refF1 = ultimoF1Map.get(esR ? 'rucula' : 'lechuga') || (esR ? 10 : 20);
    if (l.fase_actual === 'fase_1' && diasF1 > refF1 * 1.5 && diasF1 > 15) {
      alertas.push({ tipo: 'warn', msg: `${l.id_lote} lleva ${diasF1}d en F1 (últ. cosecha: ${refF1}d) — demorado`, lote: l.id_lote, categoria: 'lote_atraso' });
    }

    // 🟡 Lote en plantinera > 30 días
    if (l.fase_actual === 'plantin' && diasSiembra > 30) {
      alertas.push({ tipo: 'warn', msg: `${l.id_lote} lleva ${diasSiembra}d en plantinera — trasplantar`, lote: l.id_lote, categoria: 'lote_atraso' });
    }
  }

  // 🟡 Sin siembras en últimos 7 días
  const hace7 = new Date(hoy); hace7.setDate(hoy.getDate() - 7);
  const siembrasRecientes = lotes.filter(l => { const f = safeDate(l.fecha_siembra); return f && f >= hace7; });
  if (siembrasRecientes.length === 0) {
    alertas.push({ tipo: 'warn', msg: 'Sin siembras en los últimos 7 días — posible gap de producción', categoria: 'general' });
  }

  // 🟡 Ocupación total > 95%
  if (ocGlobal > 95) {
    alertas.push({ tipo: 'warn', msg: `Ocupación global al ${ocGlobal}% — sin espacio para nuevos trasplantes`, categoria: 'general' });
  }

  // 🔵 Mesadas F2 con capacidad > 50% libre (oportunidad) — con cantidad de tubos y
  // posiciones (tubos × orificios/tubo = plantas que entran) para que se note el peso
  // real de la oportunidad, no solo el %. Excluye las totalmente vacías (tubos_ocupados
  // === 0): esas siempre cumplen ">50% libre" también, así que sin este filtro salían
  // duplicadas con la alerta de "vacía" de más abajo — misma mesada, dos avisos.
  for (const nave of tubosMesadas) {
    for (const m of nave.mesadas || []) {
      if (m.sector_fase === 'fase_2' && m.tubos_totales > 10 && m.tubos_ocupados > 0 && m.tubos_libres > m.tubos_totales * 0.5) {
        alertas.push({ tipo: 'info', msg: `${m.nombre.replace(/^Nave \d+ - /, '')} F2 al ${m.ocupacion_pct}% — espacio disponible (${m.tubos_libres} de ${m.tubos_totales} tubos libres${m.posiciones_totales > 0 ? `, ${m.posiciones_totales.toLocaleString('es-AR')} posiciones en total` : ''})`, categoria: 'general' });
      }
    }
  }

  // 🔵 Mesadas vacías (prioridad 0 — van primero) — mismo criterio, para darle más peso
  // a una mesada grande vacía que a una chica.
  for (const nave of tubosMesadas) {
    for (const m of nave.mesadas || []) {
      if (m.tubos_totales > 10 && m.tubos_ocupados === 0) {
        alertas.push({ tipo: 'info', msg: `${m.nombre.replace(/^Nave \d+ - /, '')} — vacía (${m.tubos_totales} tubos${m.posiciones_totales > 0 ? `, ${m.posiciones_totales.toLocaleString('es-AR')} posiciones en total` : ''})`, prioridad: 0, categoria: 'general' });
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

function numAP(v: any): number { const n = Number(v); return isNaN(n) ? 0 : n; }

// 🔴 Insumos con stock estimado por debajo de N días de uso — mismo motor que "Uso Teórico"
// de Stocks (calcularUsoTeorico + drivers de producción/venta), pero acá se usa para proyectar
// el stock ACTUAL (a hoy, no a fin de mes) y compararlo contra el ritmo de consumo diario.
// Solo se evalúan artículos con fórmula configurada y con algún historial en Stocks — sin eso
// no hay forma de estimar nada (evita falsos positivos en artículos nunca cargados).
export function alertasStockBajo(
  articulos: Articulo[], stocks: StockMes[],
  driversActual: DriversMes, driversMesAnterior: DriversMes,
  anioActual: number, mesActual: number, diasEnMesAnterior: number, umbralDias = 15
): Alerta[] {
  const diasTranscurridos = new Date().getDate();
  let mesAnteriorNum = mesActual - 1, anioAnteriorNum = anioActual;
  if (mesAnteriorNum === 0) { mesAnteriorNum = 12; anioAnteriorNum--; }

  const alertas: Alerta[] = [];
  for (const art of articulos.filter((a) => a.activo === 'SI' && a.formula_uso)) {
    const stockDelArticulo = stocks.filter((s) => String(s.id_articulo) === String(art.id_articulo));
    if (!stockDelArticulo.length) continue; // sin ningún registro histórico, no se puede estimar

    const actualRow = stockDelArticulo.find((s) => String(s.anio) === String(anioActual) && String(s.mes) === String(mesActual));
    const anteriorRow = stockDelArticulo.find((s) => String(s.anio) === String(anioAnteriorNum) && String(s.mes) === String(mesAnteriorNum));
    const ini = actualRow ? numAP(actualRow.stock_inicial) : numAP(anteriorRow?.stock_final);
    const comp = numAP(actualRow?.compras);
    const finManual = numAP(actualRow?.stock_final);
    const factor = Number(art.factor_uso) || 0;

    // Stock "del momento": si ya hay un conteo manual cargado este mes se usa ese (más preciso
    // que cualquier estimación); si no, se proyecta inicial + compras − uso teórico acumulado
    // en lo que va del mes (drivers reales a la fecha, no proyectados).
    const usoTeoricoActual = calcularUsoTeorico(art.formula_uso, factor, driversActual);
    const stockActual = finManual > 0 ? finManual : Math.max(0, ini + comp - (usoTeoricoActual ?? 0));

    // Ritmo diario: preferimos el mes pasado COMPLETO (más estable) y sólo si no hay uso ahí
    // (insumo nuevo, estacional, etc.) caemos al ritmo parcial de lo que va del mes actual.
    const usoTeoricoMesAnterior = calcularUsoTeorico(art.formula_uso, factor, driversMesAnterior);
    let usoPorDia: number | null = null;
    if (usoTeoricoMesAnterior && usoTeoricoMesAnterior > 0 && diasEnMesAnterior > 0) usoPorDia = usoTeoricoMesAnterior / diasEnMesAnterior;
    else if (usoTeoricoActual && usoTeoricoActual > 0 && diasTranscurridos > 0) usoPorDia = usoTeoricoActual / diasTranscurridos;
    if (!usoPorDia || usoPorDia <= 0) continue;

    const diasDeUso = stockActual / usoPorDia;
    if (diasDeUso < umbralDias) {
      const diasTxt = Math.max(0, Math.round(diasDeUso));
      const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });
      const u = art.unidad_medida;
      // Se muestra la cuenta completa, no solo el resultado — a pedido explícito, para
      // poder revisar de un vistazo si el número raro viene de un stock inicial mal
      // cargado, de una fórmula de uso teórico desviada, o si es real.
      const cuenta = finManual > 0
        ? `stock final cargado ${fmt(finManual)} ${u} (conteo manual)`
        : `stock inicial ${fmt(ini)} ${u}${comp > 0 ? ` + compras ${fmt(comp)} ${u}` : ''} − uso teórico al día ${diasTranscurridos} (${fmt(usoTeoricoActual ?? 0)} ${u}) = stock teórico ${fmt(stockActual)} ${u}`;
      alertas.push({
        tipo: 'error',
        msg: `${art.articulo}: ${cuenta} · ritmo ${fmt(usoPorDia)} ${u}/día → dura ~${diasTxt}d más — reponer`,
      });
    }
  }
  return alertas;
}
