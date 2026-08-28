import { readSheet } from './sheets';
import type { Lote, Movimiento, Ubicacion, Variedad, VentaDia, PrecioVenta, ClienteVenta, VentaHistorica, StockCamara } from './types';
import { tubosPorMesada, type OcupacionHistorialRow } from './ocupacion';
import { cosechasEstimadasPorLote, ciclosPorSemana, pesoPromedioRango, pesoPromedioMes, mesAnteriorClamp, cicloMesPromedio, type PesoPromedioMes } from './estadisticas';
import { calcularCamara, diferenciaAjustesRango } from './camara';
import { ventasPorCultivoUltimasSemanas, resumenMesActual, ventasEnRango, GR_PAQ_RUCULA, GR_PAQ_LECHUGA, type PuntoVentaCultivoSemana, type VentasRango, type ResumenMesActual } from './estadisticasVentas';
import { plantasPerdidasPorSubocupacion, type PlantasPerdidasSubocupacion } from './kpisOperativos';

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function lunesDe(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}
const fmtISO = (d: Date) => d.toISOString().slice(0, 10);
const esRuculaV = (v: string) => { const x = String(v || '').toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };

// Unidades vendidas totales de una fila de Ventas (todo lo que factura, kg convertidos a
// paquete-equivalente con el mismo factor que el resto de la app) — para comparar
// clientes en volumen real, no en kg crudo (que los haría ver artificialmente chicos).
function unidadesVentaFila(v: VentaDia): number {
  const directas = (Number(v.rucula) || 0) + (Number(v.bandeja_rucula) || 0) + (Number(v.lechuga_crespa) || 0) + (Number(v.hoja_roble) || 0) + (Number(v.albahaca) || 0);
  const kgR = ((Number(v.rucula_kg) || 0) * 1000) / GR_PAQ_RUCULA;
  const kgL = (((Number(v.lechuga_kg) || 0) + (Number(v.lechuga_kg_crespa) || 0) + (Number(v.lechuga_kg_roble) || 0)) * 1000) / GR_PAQ_LECHUGA;
  return directas + kgR + kgL;
}
function sumaPorClienteEnRango(ventas: VentaDia[], desde: string, hasta: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of ventas) {
    const f = String(v.fecha || '').split(/[T ]/)[0];
    if (!f || f < desde || f > hasta) continue;
    const t = unidadesVentaFila(v); if (t <= 0) continue;
    map.set(v.id_control, (map.get(v.id_control) || 0) + t);
  }
  return map;
}
export interface ClienteVariacionSemana { nombre: string; actual: number; anterior: number; deltaUnidades: number; deltaPct: number | null }
// Principales clientes de la semana (por volumen), con cuánto subieron/bajaron en
// cantidad y % vs. la semana anterior — mismas ventanas de fecha que "Ventas — últimos 7 días".
function clientesConVariacionSemana(ventas: VentaDia[], clientes: ClienteVenta[], desde: string, hasta: string, desdeAnt: string, hastaAnt: string, topN = 6): ClienteVariacionSemana[] {
  const actual = sumaPorClienteEnRango(ventas, desde, hasta);
  const anterior = sumaPorClienteEnRango(ventas, desdeAnt, hastaAnt);
  const nombreMap = new Map(clientes.map(c => [c.id_control, c.nombre_display || c.nombre_xubio || c.id_control]));
  const filas = Array.from(actual.entries()).map(([id_control, act]) => {
    const ant = anterior.get(id_control) || 0;
    const deltaUnidades = Math.round(act - ant);
    const deltaPct = ant > 0 ? Math.round(((act - ant) / ant) * 100) : null;
    return { nombre: nombreMap.get(id_control) || id_control, actual: Math.round(act), anterior: Math.round(ant), deltaUnidades, deltaPct };
  });
  return filas.sort((a, b) => b.actual - a.actual).slice(0, topN);
}

export interface DescarteFaseReporte {
  cultivo: string; plantinF1: number; f1F2: number; f2Cosecha: number; total: number;
  // Base = lo que PASÓ por esa fase (descartado + lo que siguió vivo). El % se calcula
  // sobre eso: un descarte de 1.200 plantas puede ser grave o irrelevante según si por ahí
  // pasaron 3.000 o 300.000, y el número suelto no lo dice.
  basePlantinF1: number; baseF1F2: number; baseF2Cosecha: number;
}
// Descarte (plantas) de las últimas N semanas, por cultivo (rúcula vs. lechuga
// combinada, mismo criterio esRuculaV que el resto de este reporte) Y por la etapa donde
// se pierde — Plantín→F1, F1→F2 (Movimientos tipo "trasplante") y F2→Cosecha (Movimientos
// tipo "cosecha") — para poder ver DÓNDE se concentra la pérdida, no solo cuánta hay.
function descartePorFaseUltimasSemanas(lotes: Lote[], movimientos: Movimiento[], nSemanas = 4): DescarteFaseReporte[] {
  const hoy = new Date();
  const lunesActual = lunesDe(hoy);
  const inicio = new Date(lunesActual); inicio.setDate(inicio.getDate() - (nSemanas - 1) * 7);
  const fin = new Date(hoy); fin.setHours(23, 59, 59);
  const lotesMap = new Map(lotes.map(l => [l.id_lote, l]));
  const cero = () => ({ plantinF1: 0, f1F2: 0, f2Cosecha: 0, basePlantinF1: 0, baseF1F2: 0, baseF2Cosecha: 0 });
  const acc = { rucula: cero(), lechuga: cero() };
  for (const m of movimientos) {
    if (!m.fecha) continue;
    const descarte = Number(m.descarte_calculado) || 0;
    const plantas = Number(m.plantas_estimadas) || 0;
    const f = new Date(String(m.fecha) + 'T12:00:00');
    if (isNaN(f.getTime()) || f < inicio || f > fin) continue;
    const lote = lotesMap.get(String(m.id_lote || '')); if (!lote) continue;
    const key = esRuculaV(lote.variedad) ? 'rucula' : 'lechuga';
    if (m.tipo === 'trasplante') {
      // plantas_estimadas son las que SIGUIERON (el descarte va aparte) -> base = suma.
      const base = plantas + descarte;
      if (base <= 0) continue;
      if (m.fase_origen === 'plantin' && m.fase_destino === 'fase_1') { acc[key].plantinF1 += descarte; acc[key].basePlantinF1 += base; }
      else if (m.fase_origen === 'fase_1' && m.fase_destino === 'fase_2') { acc[key].f1F2 += descarte; acc[key].baseF1F2 += base; }
    } else if (m.tipo === 'cosecha') {
      // En cosecha plantas_estimadas YA incluye el descarte -> es la base directamente.
      const base = plantas > 0 ? plantas : descarte;
      if (base <= 0) continue;
      acc[key].f2Cosecha += descarte; acc[key].baseF2Cosecha += base;
    }
  }
  return (['rucula', 'lechuga'] as const).map((k) => ({
    cultivo: k === 'rucula' ? 'Rúcula' : 'Lechuga',
    plantinF1: Math.round(acc[k].plantinF1), f1F2: Math.round(acc[k].f1F2), f2Cosecha: Math.round(acc[k].f2Cosecha),
    total: Math.round(acc[k].plantinF1 + acc[k].f1F2 + acc[k].f2Cosecha),
    basePlantinF1: Math.round(acc[k].basePlantinF1), baseF1F2: Math.round(acc[k].baseF1F2), baseF2Cosecha: Math.round(acc[k].baseF2Cosecha),
  }));
}

// Proyección de cosecha MENSUAL (no semanal — la semanal no se estaba cumpliendo, mucho
// ruido de una semana a la otra). El mes en curso suma lo YA cosechado hasta hoy (real,
// de Movimientos) + lo proyectado para lo que resta del mes (de proyeccionCosechaSemanal,
// que solo proyecta semanas desde la actual en adelante); los meses futuros son 100%
// proyección. Reutiliza el mismo motor semanal por lote, solo cambia el bucket de tiempo.
function proyeccionCosechaMensual(
  lotes: Lote[], variedades: Variedad[], movimientos: Movimiento[], nMeses = 4
): { label: string; rucula: number; lechuga: number }[] {
  const hoy = new Date();
  const meses = Array.from({ length: nMeses }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
    return { label: `${MESES_CORTO[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, clave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, rucula: 0, lechuga: 0 };
  });
  const idxPorMes = new Map(meses.map((m, i) => [m.clave, i]));
  // Se atribuye cada lote al mes de SU fecha estimada. Antes esto sumaba buckets semanales
  // cuyo lunes caía en el mes, y una semana a caballo de dos meses se contaba entera en el
  // mes de su lunes: parada a fin de mes, la semana siguiente (casi toda del mes que viene)
  // engordaba el mes actual. Los lotes VENCIDOS (fecha estimada ya pasada y todavía sin
  // cosechar) se cuentan en el mes en curso, que es cuando realmente se van a levantar.
  const claveMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const claveMesEnCurso = claveMes(hoy);
  for (const est of cosechasEstimadasPorLote(lotes, variedades, hoy)) {
    const idx = idxPorMes.get(est.vencido ? claveMesEnCurso : claveMes(est.fecha));
    if (idx === undefined) continue;
    // La albahaca va sumada a "lechuga" para no agregar una fila al mail — lo importante es
    // que quede del MISMO lado que en la parte ya cosechada de abajo.
    if (est.cultivo === 'rucula') meses[idx].rucula += est.paquetes;
    else meses[idx].lechuga += est.paquetes;
  }
  // Sumar lo ya cosechado este mes hasta hoy, para que el mes en curso muestre el total
  // esperado del mes (no solo lo que falta de acá a fin de mes).
  const iniMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const lotesMap = new Map(lotes.map(l => [l.id_lote, l]));
  const claveMesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const idxMesActual = idxPorMes.get(claveMesActual);
  if (idxMesActual !== undefined) {
    for (const m of movimientos) {
      if (m.tipo !== 'cosecha' || !m.fecha) continue;
      const f = new Date(String(m.fecha) + 'T12:00:00');
      if (isNaN(f.getTime()) || f < iniMesActual || f > hoy) continue;
      const lote = lotesMap.get(String(m.id_lote)); if (!lote) continue;
      const cant = Number(m.unidades_cosechadas) || 0; if (cant <= 0) continue;
      if (esRuculaV(lote.variedad)) meses[idxMesActual].rucula += cant; else meses[idxMesActual].lechuga += cant;
    }
  }
  return meses.map(({ label, rucula, lechuga }) => ({ label, rucula: Math.round(rucula), lechuga: Math.round(lechuga) }));
}

// Cosechado REAL (Movimientos, no estimado) en un rango de fechas — para "mes pasado
// real completo", comparable contra la proyección total del mes en curso.
function cosechaRealEnRango(lotes: Lote[], movimientos: Movimiento[], desde: Date, hasta: Date): { rucula: number; lechuga: number } {
  const lotesMap = new Map(lotes.map(l => [l.id_lote, l]));
  const acc = { rucula: 0, lechuga: 0 };
  for (const m of movimientos) {
    if (m.tipo !== 'cosecha' || !m.fecha) continue;
    const f = new Date(String(m.fecha) + 'T12:00:00');
    if (isNaN(f.getTime()) || f < desde || f > hasta) continue;
    const lote = lotesMap.get(String(m.id_lote)); if (!lote) continue;
    const cant = Number(m.unidades_cosechadas) || 0; if (cant <= 0) continue;
    if (esRuculaV(lote.variedad)) acc.rucula += cant; else acc.lechuga += cant;
  }
  return acc;
}

export interface ReporteSemanalData {
  fechaGenerado: string;
  ventasSemana: VentasRango;
  ventasSemanaAnterior: VentasRango;
  ventasMesActual: ResumenMesActual;
  ventasMesAnteriorTotal: number;
  clientesVariacion: ClienteVariacionSemana[];
  proyeccionMesActual: { rucula: number; lechuga: number };
  cosechaRealMesAnterior: { rucula: number; lechuga: number };
  cicloSemana: { rucula: number; lechuga: number };
  cicloSemanaAnterior: { rucula: number; lechuga: number };
  cicloMesAnterior: { rucula: number; lechuga: number };
  pesoSemana: PesoPromedioMes;
  pesoMesAnterior: PesoPromedioMes;
  ocupacion: { nave: number; pct: number }[];
  mesadasBajas: { nombre: string; nave: number; pct: number }[];
  plantasPerdidasSubocupacion: PlantasPerdidasSubocupacion;
  ventasSemanas: PuntoVentaCultivoSemana[];
  stock: { rucula: number; lechuga_crespa: number; lechuga_roble: number; albahaca: number };
  faltanteSemana: { rucula: number; lechuga_crespa: number; lechuga_roble: number; albahaca: number; total: number };
  faltanteMes: { rucula: number; lechuga_crespa: number; lechuga_roble: number; albahaca: number; total: number };
  descartePorFase: DescarteFaseReporte[];
}

export async function obtenerDatosReporteSemanal(): Promise<ReporteSemanalData> {
  const [lotes, movimientos, ubicaciones, variedades, ventas, precios, clientes, historicas, registrosCamara, ocupacionHistorial] = await Promise.all([
    readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones'),
    readSheet<Variedad>('Variedades'), readSheet<VentaDia>('Ventas'), readSheet<PrecioVenta>('Precios'),
    readSheet<ClienteVenta>('Clientes'),
    readSheet<VentaHistorica>('VentasHistoricas').catch(() => []),
    readSheet<StockCamara>('StockCamara').catch(() => []),
    readSheet<OcupacionHistorialRow>('OcupacionHistorial').catch(() => []),
  ]);
  void historicas; // no se usa en la evolución semanal (los históricos son totales mensuales)

  const hoy = new Date();
  const mesPasadoRef = mesAnteriorClamp(hoy);

  // ── Ventas: últimos 7 días vs los 7 días anteriores a esos ──
  const hastaHoy = fmtISO(hoy);
  const desdeSemana = fmtISO(new Date(hoy.getTime() - 6 * 86400000));
  const hastaAnt = fmtISO(new Date(hoy.getTime() - 7 * 86400000));
  const desdeAnt = fmtISO(new Date(hoy.getTime() - 13 * 86400000));
  const ventasSemana = ventasEnRango(ventas, precios, clientes, desdeSemana, hastaHoy);
  const ventasSemanaAnterior = ventasEnRango(ventas, precios, clientes, desdeAnt, hastaAnt);

  // ── Ventas del mes en curso: acumulado a hoy, proyección a fin de mes y total real del mes pasado ──
  const ventasMesActual = resumenMesActual(ventas, precios, clientes, hoy);
  const diasEnMesPasado = new Date(mesPasadoRef.getFullYear(), mesPasadoRef.getMonth() + 1, 0).getDate();
  const ventasMesAnteriorTotal = resumenMesActual(ventas, precios, clientes, mesPasadoRef, diasEnMesPasado).unidadesMes;

  // ── Proyección de cosecha MENSUAL (no semanal — la semanal no se estaba cumpliendo),
  // SOLO el mes en curso (a pedido: nada de proyección de meses futuros, muy poco
  // confiable a esa distancia) vs. lo realmente cosechado el mes pasado completo ──
  const [proyeccionMesActual] = proyeccionCosechaMensual(lotes, variedades, movimientos, 1);
  const inicioMesPasado = new Date(mesPasadoRef.getFullYear(), mesPasadoRef.getMonth(), 1);
  const finMesPasado = new Date(mesPasadoRef.getFullYear(), mesPasadoRef.getMonth() + 1, 0, 23, 59, 59);
  const cosechaRealMesAnterior = cosechaRealEnRango(lotes, movimientos, inicioMesPasado, finMesPasado);

  // ── Principales clientes de la semana, con variación vs. semana anterior ──
  const clientesVariacion = clientesConVariacionSemana(ventas, clientes, desdeSemana, hastaHoy, desdeAnt, hastaAnt, 6);

  // ── Descarte por cultivo Y por fase (dónde se pierde), últimas 4 semanas ──
  const descartePorFase = descartePorFaseUltimasSemanas(lotes, movimientos, 4);

  // ── Ciclos F2: esta semana vs. semana pasada (rolling, mismo criterio que el Panel) y vs. mes pasado ──
  const ciclosSemanas = ciclosPorSemana(lotes, movimientos);
  const ultSem = ciclosSemanas[ciclosSemanas.length - 1] || { rucula: 0, lechugaF2: 0 };
  const antSem = ciclosSemanas[ciclosSemanas.length - 2] || { rucula: 0, lechugaF2: 0 };
  const cicloSemana = { rucula: ultSem.rucula || 0, lechuga: ultSem.lechugaF2 || 0 };
  const cicloSemanaAnterior = { rucula: antSem.rucula || 0, lechuga: antSem.lechugaF2 || 0 };
  const cicloMesAnterior = cicloMesPromedio(lotes, movimientos, mesPasadoRef);

  // ── Plantas perdidas por subocupación esta semana — traduce los tubos vacíos F2 a
  // plantas usando el ciclo ACTUAL de la semana (cicloSemana, recién calculado arriba)
  // como referencia, para darle dimensión real a lo que se dejó de producir. Si esta
  // semana no tuvo ninguna cosecha (sin ciclo real), cae a un ciclo de referencia
  // razonable (35d rúcula / 40d lechuga) para no dejar el cálculo en cero solo por eso. ──
  const plantasPerdidasSubocupacion = plantasPerdidasPorSubocupacion(
    ocupacionHistorial, ubicaciones, desdeSemana, hastaHoy,
    cicloSemana.rucula || 35, cicloSemana.lechuga || 40,
    movimientos, // margen de 24hs post-cosecha
  );

  // ── Peso promedio de esta semana vs. promedio del mes pasado completo ──
  const desde7 = new Date(hoy); desde7.setDate(desde7.getDate() - 7);
  const pesoSemana = pesoPromedioRango(lotes, desde7, hoy);
  const pesoMesAnterior = pesoPromedioMes(lotes, mesPasadoRef);

  // ── Ocupación por nave (F2) + mesadas puntuales por debajo del 90% ──
  const tubosMesadas = tubosPorMesada(ubicaciones, lotes);
  const ocupacion = tubosMesadas.map((n: any) => {
    const f2 = (n.mesadas || []).filter((m: any) => m.sector_fase !== 'fase_1');
    const tot = f2.reduce((s: number, m: any) => s + m.tubos_totales, 0);
    const ocu = f2.reduce((s: number, m: any) => s + m.tubos_ocupados, 0);
    return { nave: n.nave, pct: tot > 0 ? Math.round((ocu / tot) * 100) : 0 };
  });
  const mesadasBajas = tubosMesadas.flatMap((n: any) => (n.mesadas || [])
    .filter((m: any) => m.sector_fase !== 'fase_1' && m.tubos_totales > 10 && m.ocupacion_pct < 90)
    .map((m: any) => ({ nombre: String(m.nombre).replace(/^Nave \d+ - /, ''), nave: n.nave, pct: m.ocupacion_pct })))
    .sort((a: any, b: any) => a.pct - b.pct);

  // ── Ventas por cultivo, últimas 4 semanas calendario completas (lunes a domingo) ──
  const ventasSemanas = ventasPorCultivoUltimasSemanas(ventas, precios, clientes, 4);

  // ── Stock en cámara + faltante acumulado por ajustes del mes en curso ──
  const stock = {
    rucula: calcularCamara('rucula', registrosCamara, lotes, ventas).stockActual,
    lechuga_crespa: calcularCamara('lechuga_crespa', registrosCamara, lotes, ventas).stockActual,
    lechuga_roble: calcularCamara('lechuga_roble', registrosCamara, lotes, ventas).stockActual,
    albahaca: calcularCamara('albahaca', registrosCamara, lotes, ventas).stockActual,
  };
  const inicioMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finMesActual = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);
  const ajusteRuc = diferenciaAjustesRango('rucula', registrosCamara, lotes, ventas, inicioMesActual, finMesActual);
  const ajusteLecCrespa = diferenciaAjustesRango('lechuga_crespa', registrosCamara, lotes, ventas, inicioMesActual, finMesActual);
  const ajusteLecRoble = diferenciaAjustesRango('lechuga_roble', registrosCamara, lotes, ventas, inicioMesActual, finMesActual);
  const ajusteAlb = diferenciaAjustesRango('albahaca', registrosCamara, lotes, ventas, inicioMesActual, finMesActual);
  const faltanteMes = {
    rucula: ajusteRuc.acumulado, lechuga_crespa: ajusteLecCrespa.acumulado, lechuga_roble: ajusteLecRoble.acumulado, albahaca: ajusteAlb.acumulado,
    total: ajusteRuc.acumulado + ajusteLecCrespa.acumulado + ajusteLecRoble.acumulado + ajusteAlb.acumulado,
  };
  // Faltante de la SEMANA — mismo cálculo, acotado a los últimos 7 días (desdeSemana/hoy),
  // no al mes calendario completo.
  const inicioSemanaDia = new Date(desdeSemana + 'T00:00:00');
  const finSemanaDia = new Date(hastaHoy + 'T23:59:59');
  const ajusteSemRuc = diferenciaAjustesRango('rucula', registrosCamara, lotes, ventas, inicioSemanaDia, finSemanaDia);
  const ajusteSemLecCrespa = diferenciaAjustesRango('lechuga_crespa', registrosCamara, lotes, ventas, inicioSemanaDia, finSemanaDia);
  const ajusteSemLecRoble = diferenciaAjustesRango('lechuga_roble', registrosCamara, lotes, ventas, inicioSemanaDia, finSemanaDia);
  const ajusteSemAlb = diferenciaAjustesRango('albahaca', registrosCamara, lotes, ventas, inicioSemanaDia, finSemanaDia);
  const faltanteSemana = {
    rucula: ajusteSemRuc.acumulado, lechuga_crespa: ajusteSemLecCrespa.acumulado, lechuga_roble: ajusteSemLecRoble.acumulado, albahaca: ajusteSemAlb.acumulado,
    total: ajusteSemRuc.acumulado + ajusteSemLecCrespa.acumulado + ajusteSemLecRoble.acumulado + ajusteSemAlb.acumulado,
  };

  return {
    fechaGenerado: fmtISO(hoy),
    ventasSemana, ventasSemanaAnterior, ventasMesActual, ventasMesAnteriorTotal, clientesVariacion,
    proyeccionMesActual, cosechaRealMesAnterior,
    cicloSemana, cicloSemanaAnterior, cicloMesAnterior,
    pesoSemana, pesoMesAnterior,
    ocupacion, mesadasBajas, plantasPerdidasSubocupacion, ventasSemanas,
    stock, faltanteSemana, faltanteMes, descartePorFase,
  };
}

// ── Armado del mail y envío (Resend) ──

const fmtN = (n: number) => Math.round(n).toLocaleString('es-AR');
const fmtMoneda = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
function pct(actual: number, ref: number): number | null { return ref ? Math.round(((actual - ref) / ref) * 100) : null; }
function flechaHtml(p: number | null, mejorSiSube: boolean): string {
  if (p === null) return '<span style="color:#9ca3af">—</span>';
  const bueno = mejorSiSube ? p > 0 : p < 0;
  const color = p === 0 ? '#9ca3af' : bueno ? '#059669' : '#dc2626';
  const flecha = p > 0 ? '↑' : p < 0 ? '↓' : '·';
  return `<span style="color:${color};font-weight:700">${flecha} ${Math.abs(p)}%</span>`;
}
// Igual que flechaHtml pero en paquetes en vez de %, para valores que pueden cruzar cero
// (un % ahí no dice nada útil — ej. pasar de -10 a +3 no es "-130%").
function flechaPaqHtml(delta: number, mejorSiSube: boolean): string {
  const bueno = mejorSiSube ? delta > 0 : delta < 0;
  const color = delta === 0 ? '#9ca3af' : bueno ? '#059669' : '#dc2626';
  const flecha = delta > 0 ? '↑' : delta < 0 ? '↓' : '·';
  return `<span style="color:${color};font-weight:700">${flecha} ${Math.abs(delta)} paq</span>`;
}

function filaVentas(label: string, actual: { unidades: number; monto: number }, ref: { unidades: number; monto: number }): string {
  return `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(actual.unidades)} u</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtMoneda(actual.monto)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(actual.unidades, ref.unidades), true)}</td>
  </tr>`;
}

// Gráfico de barras "email-safe": dos series por columna, con altura real (no
// acumulada a 100%) — para proyección de cosecha. Usa tablas anidadas con una celda
// "espaciadora" arriba de cada barra en vez de flexbox: Outlook (y varios clientes de
// mail más) no soporta display:flex, así que las barras quedaban colgando desde arriba
// en vez de crecer desde una base común abajo. Con tablas, cada <td> apila de forma
// predecible en cualquier cliente.
function graficoBarrasHtml(
  puntos: { label: string; a: number; b: number }[],
  colorA: string, colorB: string, nombreA: string, nombreB: string
): string {
  const max = Math.max(...puntos.flatMap(p => [p.a, p.b]), 1);
  const ALTO = 70;
  const barraHtml = (valor: number, color: string, nombre: string) => {
    const h = Math.max(1, Math.round((valor / max) * ALTO));
    const espacio = Math.max(0, ALTO - h);
    return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
        <td style="height:${espacio}px;line-height:${espacio}px;font-size:1px">&nbsp;</td>
      </tr><tr>
        <td width="14" style="width:14px;height:${valor > 0 ? h : 0}px;line-height:${valor > 0 ? h : 0}px;background:${color};border-radius:2px 2px 0 0;font-size:1px" title="${nombre} ${valor}">&nbsp;</td>
      </tr></table>`;
  };
  const cols = puntos.map(p => `<td style="text-align:center;vertical-align:bottom;padding:0 6px">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
        <td style="vertical-align:bottom;padding:0 1px">${barraHtml(p.a, colorA, nombreA)}</td>
        <td style="vertical-align:bottom;padding:0 1px">${barraHtml(p.b, colorB, nombreB)}</td>
      </tr></table>
      <div style="font-size:9px;color:#9ca3af;margin-top:3px;white-space:nowrap">${p.label}</div>
      <div style="font-size:9px;color:${colorA};font-weight:700;white-space:nowrap">${fmtN(p.a)}</div>
      <div style="font-size:9px;color:${colorB};font-weight:700;white-space:nowrap">${fmtN(p.b)}</div>
    </td>`).join('');
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>${cols}</tr></table>
    <p style="font-size:11px;color:#9ca3af;margin:6px 0 0">
      <span style="color:${colorA}">■</span> ${nombreA} · <span style="color:${colorB}">■</span> ${nombreB}
    </p>`;
}

function filaCliente(c: ClienteVariacionSemana): string {
  const deltaTxt = c.deltaPct !== null
    ? flechaHtml(c.deltaPct, true)
    : (c.deltaUnidades !== 0 ? flechaPaqHtml(c.deltaUnidades, true) : '<span style="color:#9ca3af">—</span>');
  return `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${c.nombre}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(c.actual)} u</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${c.deltaUnidades >= 0 ? '+' : ''}${c.deltaUnidades} u</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${deltaTxt}</td>
  </tr>`;
}

export function construirHtml(d: ReporteSemanalData): string {
  const totalActual = {
    unidades: d.ventasSemana.rucula.unidades + d.ventasSemana.lechuga.unidades,
    monto: d.ventasSemana.rucula.monto + d.ventasSemana.lechuga.monto,
  };
  const totalAnterior = {
    unidades: d.ventasSemanaAnterior.rucula.unidades + d.ventasSemanaAnterior.lechuga.unidades,
    monto: d.ventasSemanaAnterior.rucula.monto + d.ventasSemanaAnterior.lechuga.monto,
  };
  const ventasFilas = filaVentas('Rúcula', d.ventasSemana.rucula, d.ventasSemanaAnterior.rucula)
    + filaVentas('Lechuga', d.ventasSemana.lechuga, d.ventasSemanaAnterior.lechuga)
    + `<tr style="background:#fafafa"><td style="padding:6px 10px;font-weight:800">Total</td>
        <td style="padding:6px 10px;text-align:right;font-weight:800">${fmtN(totalActual.unidades)} u</td>
        <td style="padding:6px 10px;text-align:right;font-weight:800">${fmtMoneda(totalActual.monto)}</td>
        <td style="padding:6px 10px;text-align:right">${flechaHtml(pct(totalActual.unidades, totalAnterior.unidades), true)}</td>
      </tr>`;

  const clientesFilas = d.clientesVariacion.map(filaCliente).join('');

  const cosechaFilas = (['rucula', 'lechuga'] as const).map((c) => {
    const label = c === 'rucula' ? 'Rúcula' : 'Lechuga';
    const proy = d.proyeccionMesActual[c];
    const real = d.cosechaRealMesAnterior[c];
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(proy)} paq/u</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(real)} paq/u</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(proy, real), true)}</td>
    </tr>`;
  }).join('');

  // Vs. sem./mes ant.: además de la flecha con el %, muestra el valor anterior (de dónde
  // viene) — "↓ 6%" solo no dice si venía de 30d o de 300d.
  const cicloVsHtml = (actual: number, ref: number) => ref > 0
    ? `${ref}d <span style="color:#d1d5db">·</span> ${flechaHtml(pct(actual, ref), false)}`
    : '<span style="color:#9ca3af">—</span>';
  const ciclosPesoFilas = (['rucula', 'lechuga'] as const).map((c) => {
    const label = c === 'rucula' ? 'Rúcula' : 'Lechuga';
    const ciclo = d.cicloSemana[c], cicloAntSem = d.cicloSemanaAnterior[c], cicloAntMes = d.cicloMesAnterior[c];
    const peso = d.pesoSemana[c], pesoAnt = d.pesoMesAnterior[c];
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${ciclo > 0 ? ciclo + 'd' : '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${cicloVsHtml(ciclo, cicloAntSem)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${cicloVsHtml(ciclo, cicloAntMes)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${peso > 0 ? peso + 'g' : '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaHtml(pct(peso, pesoAnt), true)}</td>
    </tr>`;
  }).join('');

  // + verde = sobra (contado por encima de lo esperado), − rojo = falta (contado por
  // debajo) — mismo signo que "Dif. acumulada mes" del resto de la app.
  const stockFilas = (['rucula', 'lechuga_crespa', 'lechuga_roble', 'albahaca'] as const).map((c) => {
    const label = c === 'rucula' ? 'Rúcula' : c === 'lechuga_crespa' ? 'Lechuga Crespa' : c === 'lechuga_roble' ? 'Lechuga Roble' : 'Albahaca';
    const faltSem = d.faltanteSemana[c], faltMes = d.faltanteMes[c];
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(d.stock[c])} paq</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaPaqHtml(faltSem, true)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${flechaPaqHtml(faltMes, true)}</td>
    </tr>`;
  }).join('');
  const stockTotalRow = `<tr style="background:#fafafa">
    <td style="padding:6px 10px;font-weight:800">Total</td>
    <td style="padding:6px 10px;text-align:right;font-weight:800">${fmtN(d.stock.rucula + d.stock.lechuga_crespa + d.stock.lechuga_roble)} paq</td>
    <td style="padding:6px 10px;text-align:right;font-weight:800">${flechaPaqHtml(d.faltanteSemana.total, true)}</td>
    <td style="padding:6px 10px;text-align:right;font-weight:800">${flechaPaqHtml(d.faltanteMes.total, true)}</td>
  </tr>`;

  const ocupacionHtml = d.ocupacion.map(o =>
    `<div style="display:inline-block;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 16px;margin-right:10px">
      <div style="font-size:11px;color:#6b7280">NAVE ${o.nave}</div>
      <div style="font-size:20px;font-weight:800;color:#111827">${o.pct}%</div>
    </div>`
  ).join('');
  const mesadasBajasHtml = d.mesadasBajas.length === 0
    ? '<p style="color:#059669;font-size:13px;margin:10px 0 0">✓ Ninguna mesada F2 por debajo del 90%.</p>'
    : `<ul style="margin:10px 0 0;padding-left:18px;font-size:13px;color:#374151">${d.mesadasBajas.map(m =>
        `<li style="margin-bottom:4px">N${m.nave} · ${m.nombre}: <strong style="color:${m.pct < 70 ? '#dc2626' : '#d97706'}">${m.pct}%</strong></li>`
      ).join('')}</ul>`;

  // Gráfico de líneas SVG anterior no se veía en Gmail (quedaba como texto suelto) — se
  // reemplaza por el mismo gráfico de barras "email-safe" (tablas) que ya funcionaba bien
  // en Proyección de cosecha.
  const ventasSemanasChart = graficoBarrasHtml(
    d.ventasSemanas.map(p => ({ label: p.label, a: p.rucula, b: p.lechuga })),
    '#134e4a', '#84cc16', 'Rúcula', 'Lechuga'
  );
  // Descarte por cultivo Y por fase — tabla en vez de gráfico de barras, para poder abrir
  // las 3 etapas (Plantín→F1, F1→F2, F2→Cosecha) y ver DÓNDE se pierde, no solo cuánto.
  // Cada fase se muestra como "descartadas (% de las que pasaron por esa fase)" — el
  // número solo no dice si es grave; el % sobre la base sí. Rojo a partir del 10%.
  const celdaFaseHtml = (desc: number, base: number) => {
    if (base <= 0) return '<span style="color:#c8c8c8">—</span>';
    const pct = Math.round((desc / base) * 1000) / 10;
    const color = pct >= 10 ? '#dc2626' : '#9ca3af';
    const peso = pct >= 10 ? '700' : '400';
    return `${fmtN(desc)} <span style="color:${color};font-weight:${peso}">(${pct}%)</span> <span style="color:#c8c8c8;font-size:11px">de ${fmtN(base)}</span>`;
  };
  const descarteFaseFilas = d.descartePorFase.map((f) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${f.cultivo}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${celdaFaseHtml(f.plantinF1, f.basePlantinF1)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${celdaFaseHtml(f.f1F2, f.baseF1F2)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${celdaFaseHtml(f.f2Cosecha, f.baseF2Cosecha)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:800">${fmtN(f.total)}</td>
    </tr>`).join('');

  return `
  <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:640px">
    <h2 style="margin:0 0 4px">Reporte semanal — Xavia</h2>
    <p style="margin:0 0 20px;color:#6b7280;font-size:13px">${d.fechaGenerado}</p>

    <h3 style="margin:0 0 8px;font-size:14px">Ventas — últimos 7 días <span style="font-weight:400;color:#9ca3af">(vs. 7 días anteriores)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Unidades</th><th style="padding:6px 10px;text-align:right">Total $</th><th style="padding:6px 10px;text-align:right">vs. semana ant.</th></tr></thead>
      <tbody>${ventasFilas}</tbody>
    </table>
    <p style="margin:0 0 8px;font-size:12px;color:#6b7280">Ventas por cultivo — últimas 4 semanas:</p>
    <div style="margin-bottom:20px">${ventasSemanasChart}</div>

    <h3 style="margin:0 0 8px;font-size:14px">Principales clientes <span style="font-weight:400;color:#9ca3af">(vs. semana anterior)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cliente</th><th style="padding:6px 10px;text-align:right">Esta semana</th><th style="padding:6px 10px;text-align:right">Diferencia</th><th style="padding:6px 10px;text-align:right">vs. semana ant.</th></tr></thead>
      <tbody>${clientesFilas || '<tr><td colspan="4" style="padding:10px;color:#9ca3af;text-align:center">Sin ventas cargadas esta semana.</td></tr>'}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Ventas — mes en curso</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">&nbsp;</th><th style="padding:6px 10px;text-align:right">Unidades</th><th style="padding:6px 10px;text-align:right">vs. mes ant.</th></tr></thead>
      <tbody>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">Acumulado al día de hoy</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmtN(d.ventasMesActual.unidadesMes)} u</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">—</td></tr>
        <tr><td style="padding:6px 10px;font-weight:600">Proyectado a fin de mes</td><td style="padding:6px 10px;text-align:right">${fmtN(d.ventasMesActual.proyeccionMes)} u</td><td style="padding:6px 10px;text-align:right">${flechaHtml(pct(d.ventasMesActual.proyeccionMes, d.ventasMesAnteriorTotal), true)}</td></tr>
        <tr><td style="padding:6px 10px;color:#9ca3af;font-size:11px" colspan="3">Mes pasado (total real): ${fmtN(d.ventasMesAnteriorTotal)} u</td></tr>
      </tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Proyección de cosecha — este mes <span style="font-weight:400;color:#9ca3af">(vs. real cosechado mes pasado)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Este mes (est.)</th><th style="padding:6px 10px;text-align:right">Mes pasado (real)</th><th style="padding:6px 10px;text-align:right">Var.</th></tr></thead>
      <tbody>${cosechaFilas}</tbody>
    </table>
    <p style="margin:-12px 0 20px;font-size:11px;color:#9ca3af;line-height:1.5">
      Es lo que se espera <strong>cosechar</strong> en el mes calendario (lo ya cosechado hasta hoy + lo estimado de los lotes activos,
      cada uno en el mes de su fecha estimada; los lotes atrasados cuentan en el mes en curso).
      No tiene por qué coincidir con "Proyectado a fin de mes" de Ventas: eso es lo que se espera <strong>vender</strong>,
      y además rúcula va en paquetes y lechuga en plantas. La diferencia entre las dos es, a grandes rasgos, lo que se acumula en cámara o se descarta.
    </p>

    <h3 style="margin:0 0 8px;font-size:14px">Ciclos y peso de esta semana</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Ciclo F2</th><th style="padding:6px 10px;text-align:right">Ciclo vs. sem. ant.</th><th style="padding:6px 10px;text-align:right">Ciclo vs. mes ant.</th><th style="padding:6px 10px;text-align:right">Peso prom.</th><th style="padding:6px 10px;text-align:right">Peso vs. mes ant.</th></tr></thead>
      <tbody>${ciclosPesoFilas}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Stock en cámara</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:6px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Stock actual</th><th style="padding:6px 10px;text-align:right">Faltante semana</th><th style="padding:6px 10px;text-align:right">Faltante acum. mes</th></tr></thead>
      <tbody>${stockFilas}${stockTotalRow}</tbody>
    </table>
    <p style="margin:0 0 20px;font-size:11px;color:#9ca3af">− (rojo) = falta, contado por debajo de lo esperado · + (verde) = sobra, contado por encima de lo esperado.</p>

    <h3 style="margin:0 0 8px;font-size:14px">Descarte por cultivo y por fase <span style="font-weight:400;color:#9ca3af">(últimas 4 semanas — plantas descartadas y % de las que pasaron por esa fase)</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">Cultivo</th><th style="padding:6px 10px;text-align:right">Plantín→F1</th><th style="padding:6px 10px;text-align:right">F1→F2</th><th style="padding:6px 10px;text-align:right">F2→Cosecha</th><th style="padding:6px 10px;text-align:right">Total</th></tr></thead>
      <tbody>${descarteFaseFilas}</tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Ocupación por nave</h3>
    <div style="margin-bottom:6px">${ocupacionHtml}</div>
    <p style="margin:10px 0 0;font-size:12px;color:#6b7280">Mesadas F2 por debajo del 90%:</p>
    <div style="margin-bottom:10px">${mesadasBajasHtml}</div>
    ${d.plantasPerdidasSubocupacion.total > 0 ? `<p style="margin:10px 0 0;font-size:12px;color:#b45309">
      🌱 ~<strong>${fmtN(d.plantasPerdidasSubocupacion.total)}</strong> plantas perdidas por subocupación esta semana
      (Rúcula ${fmtN(d.plantasPerdidasSubocupacion.rucula)} · Lechuga ${fmtN(d.plantasPerdidasSubocupacion.lechuga)})
      <span style="color:#9ca3af">— tubos vacíos convertidos a plantas, usando el ciclo F2 actual como referencia</span>
    </p>` : ''}
  </div>`;
}

// ── Versión en texto plano, pensada para copiar y pegar en WhatsApp (que no renderiza
// HTML/tablas) — mismos números que el mail, con emojis y saltos de línea en vez de
// tablas/gráficos. Se genera con los mismos `ReporteSemanalData`, así que nunca se
// desincroniza del HTML: ambos salen de la misma consulta fresca a la planilla.
export function construirTexto(d: ReporteSemanalData): string {
  const p2 = (n: number | null) => n === null ? '—' : `${n > 0 ? '+' : ''}${n}%`;
  const L: string[] = [];
  L.push(`📋 *Reporte semanal — Xavia*`);
  L.push(d.fechaGenerado);
  L.push('');

  L.push(`🛒 *Ventas — últimos 7 días* (vs. 7 días ant.)`);
  L.push(`Rúcula: ${fmtN(d.ventasSemana.rucula.unidades)} u · ${fmtMoneda(d.ventasSemana.rucula.monto)} (${p2(pct(d.ventasSemana.rucula.unidades, d.ventasSemanaAnterior.rucula.unidades))})`);
  L.push(`Lechuga: ${fmtN(d.ventasSemana.lechuga.unidades)} u · ${fmtMoneda(d.ventasSemana.lechuga.monto)} (${p2(pct(d.ventasSemana.lechuga.unidades, d.ventasSemanaAnterior.lechuga.unidades))})`);
  const totU = d.ventasSemana.rucula.unidades + d.ventasSemana.lechuga.unidades;
  const totM = d.ventasSemana.rucula.monto + d.ventasSemana.lechuga.monto;
  L.push(`Total: ${fmtN(totU)} u · ${fmtMoneda(totM)}`);
  L.push('');
  L.push(`Últimas 4 semanas (u.) — Rúcula / Lechuga:`);
  for (const s of d.ventasSemanas) L.push(`  ${s.label}: ${fmtN(s.rucula)} / ${fmtN(s.lechuga)}`);
  L.push('');

  L.push(`👤 *Principales clientes* (vs. semana ant.)`);
  if (d.clientesVariacion.length === 0) L.push('  Sin ventas cargadas esta semana.');
  for (const c of d.clientesVariacion) {
    L.push(`  ${c.nombre}: ${fmtN(c.actual)} u (${c.deltaUnidades >= 0 ? '+' : ''}${c.deltaUnidades} u, ${p2(c.deltaPct)})`);
  }
  L.push('');

  L.push(`📅 *Ventas — mes en curso*`);
  L.push(`Acumulado a hoy: ${fmtN(d.ventasMesActual.unidadesMes)} u`);
  L.push(`Proyectado a fin de mes: ${fmtN(d.ventasMesActual.proyeccionMes)} u (${p2(pct(d.ventasMesActual.proyeccionMes, d.ventasMesAnteriorTotal))} vs. mes ant.)`);
  L.push(`Mes pasado (total real): ${fmtN(d.ventasMesAnteriorTotal)} u`);
  L.push('');

  L.push(`🌱 *Proyección de cosecha — este mes* (vs. real mes pasado)`);
  L.push(`Rúcula: ${fmtN(d.proyeccionMesActual.rucula)} est. / ${fmtN(d.cosechaRealMesAnterior.rucula)} real`);
  L.push(`Lechuga: ${fmtN(d.proyeccionMesActual.lechuga)} est. / ${fmtN(d.cosechaRealMesAnterior.lechuga)} real`);
  L.push(`(Es lo que se espera COSECHAR en el mes; "Proyectado a fin de mes" de Ventas es lo que se espera VENDER — no tienen por qué coincidir.)`);
  L.push('');

  // Ciclo: al lado del valor de esta semana, de dónde viene (valor de la semana/mes
  // anterior) además de la variación — un "↓6%" solo no dice si venía de 30d o de 300d.
  const cicloVsTxt = (actual: number, ref: number) => ref > 0 ? `${ref}d (${p2(pct(actual, ref))})` : '—';
  L.push(`🔄 *Ciclos y peso de esta semana*`);
  L.push(`Rúcula: ${d.cicloSemana.rucula > 0 ? d.cicloSemana.rucula + 'd' : '—'} ciclo · sem. ant. ${cicloVsTxt(d.cicloSemana.rucula, d.cicloSemanaAnterior.rucula)} · mes ant. ${cicloVsTxt(d.cicloSemana.rucula, d.cicloMesAnterior.rucula)} · ${d.pesoSemana.rucula > 0 ? d.pesoSemana.rucula + 'g' : '—'} peso`);
  L.push(`Lechuga: ${d.cicloSemana.lechuga > 0 ? d.cicloSemana.lechuga + 'd' : '—'} ciclo · sem. ant. ${cicloVsTxt(d.cicloSemana.lechuga, d.cicloSemanaAnterior.lechuga)} · mes ant. ${cicloVsTxt(d.cicloSemana.lechuga, d.cicloMesAnterior.lechuga)} · ${d.pesoSemana.lechuga > 0 ? d.pesoSemana.lechuga + 'g' : '—'} peso`);
  L.push('');

  L.push(`❄️ *Stock en cámara* (− = falta, + = sobra)`);
  L.push(`Rúcula: ${fmtN(d.stock.rucula)} paq · semana ${d.faltanteSemana.rucula >= 0 ? '+' : ''}${d.faltanteSemana.rucula} paq · mes ${d.faltanteMes.rucula >= 0 ? '+' : ''}${d.faltanteMes.rucula} paq`);
  L.push(`Lechuga Crespa: ${fmtN(d.stock.lechuga_crespa)} paq · semana ${d.faltanteSemana.lechuga_crespa >= 0 ? '+' : ''}${d.faltanteSemana.lechuga_crespa} paq · mes ${d.faltanteMes.lechuga_crespa >= 0 ? '+' : ''}${d.faltanteMes.lechuga_crespa} paq`);
  L.push(`Lechuga Roble: ${fmtN(d.stock.lechuga_roble)} paq · semana ${d.faltanteSemana.lechuga_roble >= 0 ? '+' : ''}${d.faltanteSemana.lechuga_roble} paq · mes ${d.faltanteMes.lechuga_roble >= 0 ? '+' : ''}${d.faltanteMes.lechuga_roble} paq`);
  L.push('');

  L.push(`🗑️ *Descarte por cultivo y por fase* (plantas, últimas 4 semanas — dónde se pierde):`);
  for (const f of d.descartePorFase) {
    const pctTxt = (desc: number, base: number) => base > 0 ? `${fmtN(desc)} (${Math.round((desc / base) * 1000) / 10}% de ${fmtN(base)})` : '—';
    L.push(`  ${f.cultivo}: Plantín→F1 ${pctTxt(f.plantinF1, f.basePlantinF1)} · F1→F2 ${pctTxt(f.f1F2, f.baseF1F2)} · F2→Cosecha ${pctTxt(f.f2Cosecha, f.baseF2Cosecha)} · Total ${fmtN(f.total)}`);
  }
  L.push('');

  L.push(`🏭 *Ocupación por nave*`);
  for (const o of d.ocupacion) L.push(`  Nave ${o.nave}: ${o.pct}%`);
  if (d.mesadasBajas.length > 0) {
    L.push(`Mesadas F2 por debajo del 90%:`);
    for (const m of d.mesadasBajas) L.push(`  N${m.nave} · ${m.nombre}: ${m.pct}%`);
  } else {
    L.push(`✓ Ninguna mesada F2 por debajo del 90%.`);
  }
  if (d.plantasPerdidasSubocupacion.total > 0) {
    L.push(`🌱 ~${fmtN(d.plantasPerdidasSubocupacion.total)} plantas perdidas por subocupación esta semana (Rúcula ${fmtN(d.plantasPerdidasSubocupacion.rucula)} / Lechuga ${fmtN(d.plantasPerdidasSubocupacion.lechuga)}) — ref. ciclo F2 actual`);
  }

  return L.join('\n');
}

export async function enviarReporteSemanal(): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' };
  try {
    const datos = await obtenerDatosReporteSemanal();
    const html = construirHtml(datos);
    const text = construirTexto(datos);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: ['administracion@xavia.com.ar'],
        subject: `Reporte semanal — Xavia — ${datos.fechaGenerado}`,
        html,
        text,
      }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); return { ok: false, error: (err as any).message || `HTTP ${res.status}` }; }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error al generar el reporte' };
  }
}
