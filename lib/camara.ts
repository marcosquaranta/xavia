import type { Lote, VentaDia, StockCamara } from './types';
import { pesoPromedioRango } from './estadisticas';
import { GR_PAQ_RUCULA, GR_PAQ_LECHUGA } from './estadisticasVentas';

export type CultivoCamara = 'rucula' | 'lechuga_crespa' | 'lechuga_roble';

function parseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).split(/[\sT]/)[0];
  if (!str) return null;
  const d = new Date(str + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

// ── Regla del mediodía ──────────────────────────────────────────────────────────────
// Las entregas de venta salen de 8 a 12hs, y la cosecha del día se hace a la mañana —
// así que una venta o cosecha fechada HOY recién se considera "ya afuera/adentro de
// cámara" a partir del mediodía; antes de esa hora, el pedido/la cosecha de hoy todavía
// no impactó el stock físico real. Eventos de días anteriores siempre cuentan, sin
// importar la hora. Se calcula en huso horario de Argentina explícitamente — new Date().
// getHours() en el server (Vercel) corre en UTC y dispararía la regla 3 horas antes de
// tiempo (mismo problema que ya se corrigió en el recordatorio de "hacer stock" del Panel).
const HORA_CORTE_MEDIODIA = 12;
function horaArgentina(momento: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }).format(momento));
}
// Expuesto para quien consuma calcularCamara() y necesite saber, sin adivinar, si el
// "stockActual" que devuelve ya tiene descontadas las ventas de HOY o todavía no (regla
// del mediodía de arriba) — ej. el cuadro de "Disp. para venta" en Ventas, para no
// restar de nuevo lo que ya está restado (y para poder avisarlo en pantalla).
export function ventasDeHoyYaDescontadas(momentoRef: Date = new Date()): boolean {
  return horaArgentina(momentoRef) >= HORA_CORTE_MEDIODIA;
}
function fechaArgentina(momento: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(momento);
}
function yaConcretado(fechaEvento: any, momentoRef: Date): boolean {
  const str = String(fechaEvento || '').split(/[\sT]/)[0];
  if (!str) return false;
  const diaRef = fechaArgentina(momentoRef);
  if (str < diaRef) return true;
  if (str > diaRef) return false; // fecha futura respecto al momento de referencia — no cuenta
  return horaArgentina(momentoRef) >= HORA_CORTE_MEDIODIA;
}

// Momento REAL en que se cargó un registro de StockCamara — usa momento_carga (ms desde
// epoch) si está disponible; en registros viejos (de antes de este campo) se asume fin
// del día de su fecha, para no alterar retroactivamente cálculos ya hechos con el
// criterio anterior (que siempre contaba el mismo día como ya concretado).
function momentoDeRegistro(r: { momento_carga?: any; fecha_carga?: any; fecha: any }): Date {
  const ms = Number(r.momento_carga);
  if (ms > 0) return new Date(ms);
  const base = String(r.fecha_carga || '').trim() || String(r.fecha || '');
  const str = base.split(/[\sT]/)[0];
  const d = new Date(`${str}T23:59:59-03:00`);
  return isNaN(d.getTime()) ? new Date() : d;
}

function esRucula(variedad: string) {
  const v = String(variedad || '').toLowerCase();
  return v.includes('rucula') || v.includes('rúcula');
}
function esCrespa(variedad: string) {
  return String(variedad || '').toLowerCase().includes('crespa');
}
// "Roble" es el catch-all de lechuga (hoja de roble + cualquier otra variedad de
// lechuga que no sea explícitamente crespa) — así nunca se pierde stock de un lote con
// una variedad rara sin clasificar, igual criterio que ya se usa en lib/usoTeorico.ts.
function matchCultivo(cultivo: CultivoCamara, variedad: string): boolean {
  if (cultivo === 'rucula') return esRucula(variedad);
  if (esRucula(variedad)) return false;
  return cultivo === 'lechuga_crespa' ? esCrespa(variedad) : !esCrespa(variedad);
}

// Paquetes cosechados de `cultivo` con fecha posterior a `desde` y ya concretados
// (regla del mediodía) respecto a `momentoRef`.
function cosechadoEntre(cultivo: CultivoCamara, lotes: Lote[], desde: Date, momentoRef: Date): number {
  return lotes
    .filter(l => {
      if (l.estado !== 'cosechado') return false;
      if (!matchCultivo(cultivo, l.variedad)) return false;
      const fechaCosecha = l.fecha_cosecha || l.fecha_ult_movimiento;
      const f = parseDate(fechaCosecha);
      if (!f || !(f > desde)) return false;
      return yaConcretado(fechaCosecha, momentoRef);
    })
    .reduce((a, l) => a + (Number(l.unidades_cosechadas) || 0), 0);
}

// Gramos por paquete a usar para convertir ventas en KG a paquetes-equivalente, para
// clientes que compran por kg (ej. Select Food) — usa el peso REAL promedio de lo
// cosechado de este cultivo en la ÚLTIMA SEMANA respecto a `momentoRef` (pesoPromedioRango,
// misma fuente que ya usan el Panel/reporte semanal para "Peso promedio"), así el
// descuento de stock se ajusta solo si las plantas están saliendo más chicas o más
// grandes que el histórico — a pedido explícito, en vez de un gramaje fijo. Si esa semana
// no hubo ninguna cosecha de este cultivo para sacar un promedio, cae al valor fijo de
// siempre (mismo fallback que el resto de la app: GR_PAQ_RUCULA/GR_PAQ_LECHUGA).
function gramosPorPaqueteUltimaSemana(cultivo: CultivoCamara, lotes: Lote[], momentoRef: Date): number {
  const desde = new Date(momentoRef);
  desde.setDate(desde.getDate() - 7);
  const prom = pesoPromedioRango(lotes, desde, momentoRef);
  const gr = cultivo === 'rucula' ? prom.rucula : cultivo === 'lechuga_crespa' ? prom.lechugaCrespa : prom.lechugaRoble;
  return gr > 0 ? gr : (cultivo === 'rucula' ? GR_PAQ_RUCULA : GR_PAQ_LECHUGA);
}

// Paquetes vendidos (exportados a Xubio) de `cultivo` con fecha posterior a `desde` y ya
// concretados (regla del mediodía) respecto a `momentoRef`. El export marca `exportado`
// con el id de exportación (ej. "EXP-20260619-1430"), NO con el literal 'SI'. Por eso se
// descuenta cualquier venta con exportado no vacío. lechuga_crespa/hoja_roble ya son
// campos separados en Ventas — no hace falta clasificar por texto de variedad como con
// las cosechas. Ventas en KG (rucula_kg/lechuga_kg_crespa/lechuga_kg_roble, + el legado
// lechuga_kg sin split que cae en "roble" como catch-all, mismo criterio que
// matchCultivo) se reconvierten a paquetes-equivalente con el peso promedio de la
// semana — antes NO se descontaban del stock de cámara en absoluto (un cliente por kg
// podía vaciar la cámara entera sin que el stock se moviera un solo paquete).
function vendidoEntre(cultivo: CultivoCamara, ventas: VentaDia[], lotes: Lote[], desde: Date, momentoRef: Date): number {
  const gramosPorPaquete = gramosPorPaqueteUltimaSemana(cultivo, lotes, momentoRef);
  return ventas
    .filter(v => {
      if (!v.exportado || String(v.exportado).trim() === '') return false;
      const f = parseDate(v.fecha);
      if (!f || !(f > desde)) return false;
      return yaConcretado(v.fecha, momentoRef);
    })
    .reduce((acc, v) => {
      if (cultivo === 'rucula') {
        const directo = (Number(v.rucula) || 0) + (Number(v.bandeja_rucula) || 0);
        const kg = ((Number(v.rucula_kg) || 0) * 1000) / gramosPorPaquete;
        return acc + directo + kg;
      }
      if (cultivo === 'lechuga_crespa') {
        const directo = Number(v.lechuga_crespa) || 0;
        const kg = ((Number(v.lechuga_kg_crespa) || 0) * 1000) / gramosPorPaquete;
        return acc + directo + kg;
      }
      const directo = Number(v.hoja_roble) || 0;
      const kg = ((Number(v.lechuga_kg_roble) || 0) + (Number(v.lechuga_kg) || 0)) * 1000 / gramosPorPaquete;
      return acc + directo + kg;
    }, 0);
}

export interface ResultadoCamara {
  cultivo: CultivoCamara;
  stockActual: number;
  diasPromedio: number;
  base: StockCamara | null;
}

export function calcularCamara(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[]
): ResultadoCamara {
  const hoy = new Date();

  // Último registro base para este cultivo — si dos registros caen en la MISMA fecha
  // (ej. dos ajustes cargados el mismo día), hay que quedarse con el que se cargó
  // DESPUÉS, no con cualquiera de los dos al azar. Array.sort es estable, así que un
  // sort descendente por fecha con .find(() => true) (= tomar el primero) en realidad
  // devolvía el más VIEJO de ese empate (el que apareció primero en la hoja, no el
  // último cargado) — un segundo ajuste el mismo día quedaba "invisible": la carga se
  // guardaba bien pero el stock mostrado no cambiaba, como si el click no hubiera hecho
  // nada. Se desempata explícitamente por índice original (el cargado después gana).
  const base = registros
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.cultivo === cultivo)
    .sort((a, b) => {
      const cmp = String(b.r.fecha).localeCompare(String(a.r.fecha));
      return cmp !== 0 ? cmp : b.i - a.i;
    })[0]?.r ?? null;

  if (!base) return { cultivo, stockActual: 0, diasPromedio: 0, base: null };

  const fechaBase = parseDate(base.fecha);
  if (!fechaBase) return { cultivo, stockActual: 0, diasPromedio: 0, base };

  const cantidadBase = Number(base.cantidad_paq) || 0;

  // Cosechas desde fechaBase (exclusive: solo posteriores a la base), con la regla del
  // mediodía aplicada respecto a "ahora" — antes esto no tenía límite superior alguno,
  // así que una cosecha de HOY a la mañana ya sumaba al stock aunque el conteo se
  // estuviera haciendo antes de que termine la jornada de cosecha.
  const cosechas = lotes
    .filter(l => {
      if (l.estado !== 'cosechado') return false;
      if (!matchCultivo(cultivo, l.variedad)) return false;
      const fechaCosecha = l.fecha_cosecha || l.fecha_ult_movimiento;
      const f = parseDate(fechaCosecha);
      if (!f || !(f > fechaBase)) return false;
      return yaConcretado(fechaCosecha, hoy);
    })
    .map(l => ({ fecha: parseDate(l.fecha_cosecha || l.fecha_ult_movimiento)!, cantidad: Number(l.unidades_cosechadas) || 0 }))
    .filter(e => e.cantidad > 0);

  const totalVendido = vendidoEntre(cultivo, ventas, lotes, fechaBase, hoy);
  const totalCosechado = cosechas.reduce((a, c) => a + c.cantidad, 0);
  const stockActual = Math.max(0, cantidadBase + totalCosechado - totalVendido);

  // FIFO para días promedio
  // Cola: base primero, luego cosechas ordenadas por fecha ASC
  const cola: { fecha: Date; cantidad: number }[] = [
    { fecha: fechaBase, cantidad: cantidadBase },
    ...cosechas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
  ];

  // Descontar ventas empezando por lo más antiguo
  let porDescontar = totalVendido;
  for (const entrada of cola) {
    if (porDescontar <= 0) break;
    const desc = Math.min(entrada.cantidad, porDescontar);
    entrada.cantidad -= desc;
    porDescontar -= desc;
  }

  // Calcular días promedio ponderado de lo que queda
  const restantes = cola.filter(e => e.cantidad > 0);
  const totalRestante = restantes.reduce((a, e) => a + e.cantidad, 0);
  if (totalRestante === 0) return { cultivo, stockActual, diasPromedio: 0, base };

  const diasProm = restantes.reduce((acc, e) => {
    const dias = Math.round((hoy.getTime() - e.fecha.getTime()) / 86400000);
    return acc + dias * e.cantidad;
  }, 0) / totalRestante;

  return { cultivo, stockActual, diasPromedio: Math.round(diasProm), base };
}

// Diferencia entre una cantidad nueva (contada a mano) y lo que el sistema esperaba
// tener en cámara a esa fecha (stock teórico según la última base + movimientos desde
// entonces). Sirve tanto para avisar al cargar un ajuste como para el acumulado mensual.
export function diferenciaAjuste(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[],
  cantidadNueva: number,
  fecha: Date = new Date()
): number {
  const anteriores = [...registros]
    .filter(r => r.cultivo === cultivo)
    .map(r => ({ ...r, _f: parseDate(r.fecha), _m: momentoDeRegistro(r) }))
    .filter((r): r is StockCamara & { _f: Date; _m: Date } => !!r._f && r._m <= fecha)
    .sort((a, b) => a._m.getTime() - b._m.getTime());
  const prev = anteriores[anteriores.length - 1];
  if (!prev) return 0; // sin base previa, no hay con qué comparar

  const cosechado = cosechadoEntre(cultivo, lotes, prev._f, fecha);
  const vendido = vendidoEntre(cultivo, ventas, lotes, prev._f, fecha);
  const teorico = Math.max(0, (Number(prev.cantidad_paq) || 0) + cosechado - vendido);
  return Math.round(cantidadNueva - teorico);
}

export interface DiferenciaAjustesMes { acumulado: number; cantidadAjustes: number }

// Suma las diferencias reveladas por cada ajuste de tipo "ajuste" cuya fecha de negocio
// cae en [desde, hasta] (ambos inclusive) — "cuánto se corrigió" acumulado en ese rango.
// La secuencia prev→curr y el corte de cosechado/vendido usan el momento REAL de carga
// de cada registro (momento_carga), no solo su fecha de negocio — así un ajuste cargado
// a la mañana (antes del mediodía) no se compara contra las ventas del día como si ya
// hubieran salido, igual criterio que calcularCamara(). Base de diferenciaAjustesMes()
// (rango = el mes) y de cualquier otro rango puntual (ej. la semana del reporte semanal).
export function diferenciaAjustesRango(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[],
  desde: Date,
  hasta: Date
): DiferenciaAjustesMes {
  const ordenados = [...registros]
    .filter(r => r.cultivo === cultivo)
    .map(r => ({ ...r, _f: parseDate(r.fecha), _m: momentoDeRegistro(r) }))
    .filter((r): r is StockCamara & { _f: Date; _m: Date } => !!r._f)
    .sort((a, b) => a._m.getTime() - b._m.getTime());

  let acumulado = 0, cantidadAjustes = 0;
  for (let i = 1; i < ordenados.length; i++) {
    const curr = ordenados[i];
    if (curr.tipo !== 'ajuste') continue;
    if (curr._f < desde || curr._f > hasta) continue;
    const prev = ordenados[i - 1];
    const cosechado = cosechadoEntre(cultivo, lotes, prev._f, curr._m);
    const vendido = vendidoEntre(cultivo, ventas, lotes, prev._f, curr._m);
    const teorico = Math.max(0, (Number(prev.cantidad_paq) || 0) + cosechado - vendido);
    acumulado += Number(curr.cantidad_paq) - teorico;
    cantidadAjustes++;
  }
  return { acumulado: Math.round(acumulado), cantidadAjustes };
}

// Suma las diferencias del mes de `fechaRef` (por defecto el mes en curso).
export function diferenciaAjustesMes(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[],
  fechaRef: Date = new Date()
): DiferenciaAjustesMes {
  const desde = new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 1);
  const hasta = new Date(fechaRef.getFullYear(), fechaRef.getMonth() + 1, 0, 23, 59, 59);
  return diferenciaAjustesRango(cultivo, registros, lotes, ventas, desde, hasta);
}
