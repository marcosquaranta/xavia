import type { VentaDia, ClienteVenta, PrecioVenta, VentaHistorica } from './types';

// Gramos por paquete/planta — mismos defaults que /api/stocks/camara cuando no hay
// pesaje testigo reciente. Se usan acá para poder sumar ventas por KG (cajón) al
// mismo total en unidades que rucula/lechuga_crespa+hoja_roble.
export const GR_PAQ_RUCULA = 210;
export const GR_PAQ_LECHUGA = 330;

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const PROD_KEYS = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg'] as const;

function mesKey(fecha: string): string { return String(fecha || '').slice(0, 7); } // YYYY-MM
function mesLabel(mk: string): string {
  const [y, m] = mk.split('-').map(Number);
  return m >= 1 && m <= 12 ? `${MESES_CORTO[m - 1]}-${String(y).slice(2)}` : mk;
}
function ultimosNMeses(ventas: VentaDia[], n: number): string[] {
  const claves = Array.from(new Set(ventas.map((v) => mesKey(v.fecha)).filter((k) => /^\d{4}-\d{2}$/.test(k)))).sort();
  return claves.slice(-n);
}

// Semana = lunes de esa semana, como clave YYYY-MM-DD.
function semanaKey(fecha: string): string {
  const s = String(fecha || '').split(/[T ]/)[0];
  const d = new Date(s + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  const dow = d.getDay(); // 0=dom..6=sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function semanaLabel(sk: string): string {
  const [, m, d] = sk.split('-');
  return `${d}/${m}`;
}
function ultimasNSemanas(ventas: VentaDia[], n: number): string[] {
  const semanaActual = semanaKey(new Date().toISOString().slice(0, 10));
  const claves = Array.from(new Set(ventas.map((v) => semanaKey(v.fecha)).filter(Boolean)))
    .filter((k) => k !== semanaActual) // la semana en curso está incompleta y distorsiona la tendencia
    .sort();
  return claves.slice(-n);
}

// Lee un campo tolerando variantes de mayúsculas/acentos en el header de la planilla
// (p. ej. "Rucula" o "Rúcula" en vez de "rucula").
function campo(obj: Record<string, any>, ...nombres: string[]): any {
  for (const n of nombres) if (obj[n] !== undefined && obj[n] !== '') return obj[n];
  const keys = Object.keys(obj);
  for (const n of nombres) {
    const k = keys.find((kk) => kk.trim().toLowerCase() === n.toLowerCase());
    if (k && obj[k] !== undefined && obj[k] !== '') return obj[k];
  }
  return undefined;
}

// Acepta "2026-06", "2026/6" o el mismo formato "jun-26" que se usa en las etiquetas
// del gráfico (y que es lo más natural para tipear a mano en VentasHistoricas).
function normalizarMesHistorico(raw: any): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}`;
  const m2 = s.match(/^([a-záéíóúñ]+)[-/\s]+(\d{2,4})$/);
  if (m2) {
    const idx = MESES_CORTO.findIndex((mc) => mc.startsWith(m2[1]) || m2[1].startsWith(mc));
    if (idx >= 0) {
      const yy = m2[2].length === 4 ? m2[2].slice(2) : m2[2];
      return `20${yy}-${String(idx + 1).padStart(2, '0')}`;
    }
  }
  return null;
}

function getPrecio(precios: PrecioVenta[], id_control: string, sucursal: string, key: string, clienteSucursales?: string): number {
  let row = precios.find((p) => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal);
  if (!row && clienteSucursales) {
    for (const s of clienteSucursales.split('|').map((x) => x.trim()).filter(Boolean)) {
      row = precios.find((p) => String(p.id_control) === String(id_control) && p.sucursal_obs === s);
      if (row) break;
    }
  }
  if (!row) row = precios.find((p) => String(p.id_control) === String(id_control));
  if (!row) return 0;
  return Number((row as any)[key] || 0);
}

// Precio final que cobra el cliente (IVA incluido). En Factura A el precio cargado en
// la planilla es neto (se le suma 10,5% de IVA); en Factura B el precio cargado ya es
// el final, no se le suma nada.
const IVA_FACTURA_A = 1.105;
export function precioFinal(precios: PrecioVenta[], id_control: string, sucursal: string, key: string, cliente?: ClienteVenta): number {
  const base = getPrecio(precios, id_control, sucursal, key, cliente?.sucursales);
  return cliente?.tipo_factura === 'A' ? base * IVA_FACTURA_A : base;
}

// ── Evolución de venta por artículo (unidades: paquetes de rúcula, plantas de lechuga/albahaca) ──
export interface PuntoArticulo { mes: string; label: string; rucula: number; lechuga: number; albahaca: number }
export function evolucionVentaPorArticulo(ventas: VentaDia[], n = 12, historicas: VentaHistorica[] = []): PuntoArticulo[] {
  const historicasNorm = historicas
    .map((h) => ({
      mes: normalizarMesHistorico(campo(h as any, 'mes', 'Mes', 'MES')),
      rucula: Number(campo(h as any, 'rucula', 'Rucula', 'Rúcula', 'RUCULA')) || 0,
      lechuga: Number(campo(h as any, 'lechuga', 'Lechuga', 'Lechugas', 'LECHUGA')) || 0,
    }))
    .filter((h): h is { mes: string; rucula: number; lechuga: number } => !!h.mes);

  const claves = Array.from(new Set([
    ...ventas.map((v) => mesKey(v.fecha)).filter((k) => /^\d{4}-\d{2}$/.test(k)),
    ...historicasNorm.map((h) => h.mes),
  ])).sort();
  const meses = claves.slice(-n);
  const historicasPorMes = new Map(historicasNorm.map((h) => [h.mes, h]));

  return meses.map((mes) => {
    const historica = historicasPorMes.get(mes);
    if (historica) {
      return { mes, label: mesLabel(mes), rucula: Number(historica.rucula) || 0, lechuga: Number(historica.lechuga) || 0, albahaca: 0 };
    }
    const delMes = ventas.filter((v) => mesKey(v.fecha) === mes);
    const ruculaKgEnPaq = delMes.reduce((a, v) => a + (Number(v.rucula_kg) || 0), 0) * 1000 / GR_PAQ_RUCULA;
    const lechugaKgEnPaq = delMes.reduce((a, v) => a + (Number(v.lechuga_kg) || 0), 0) * 1000 / GR_PAQ_LECHUGA;
    const rucula = delMes.reduce((a, v) => a + (Number(v.rucula) || 0) + (Number(v.bandeja_rucula) || 0), 0) + Math.round(ruculaKgEnPaq);
    const lechuga = delMes.reduce((a, v) => a + (Number(v.lechuga_crespa) || 0) + (Number(v.hoja_roble) || 0), 0) + Math.round(lechugaKgEnPaq);
    const albahaca = delMes.reduce((a, v) => a + (Number(v.albahaca) || 0), 0);
    return { mes, label: mesLabel(mes), rucula, lechuga, albahaca };
  });
}

// ── Evolución de venta por cliente (unidades totales, top N) — mensual o semanal ──
export interface SerieCliente { id_control: string; nombre: string; total: number }
export interface EvolucionClientes { meses: { mes: string; label: string }[]; series: SerieCliente[]; puntos: Record<string, number>[] }

export function evolucionVentaPorCliente(ventas: VentaDia[], clientes: ClienteVenta[], n = 12, topN = 6): EvolucionClientes {
  const mesesKeys = ultimosNMeses(ventas, n);
  return construirEvolucionCliente(ventas, clientes, mesesKeys, mesLabel, mesKey, topN);
}

export function evolucionVentaPorClienteSemanal(ventas: VentaDia[], clientes: ClienteVenta[], n = 10, topN = 6): EvolucionClientes {
  const semanasKeys = ultimasNSemanas(ventas, n);
  return construirEvolucionCliente(ventas, clientes, semanasKeys, semanaLabel, semanaKey, topN);
}

function construirEvolucionCliente(
  ventas: VentaDia[], clientes: ClienteVenta[], claves: string[], etiqueta: (k: string) => string, keyFn: (fecha: string) => string, topN: number
): EvolucionClientes {
  const meses = claves.map((k) => ({ mes: k, label: etiqueta(k) }));
  const porCliente = new Map<string, Record<string, number>>();
  for (const v of ventas) {
    const k = keyFn(v.fecha);
    if (!claves.includes(k)) continue;
    const total = PROD_KEYS.reduce((a, kk) => a + (Number((v as any)[kk]) || 0), 0);
    if (total <= 0) continue;
    if (!porCliente.has(v.id_control)) porCliente.set(v.id_control, {});
    const rec = porCliente.get(v.id_control)!;
    rec[k] = (rec[k] || 0) + total;
  }
  const nombreMap = new Map(clientes.map((c) => [c.id_control, c.nombre_display || c.nombre_xubio || c.id_control]));
  const entradas = Array.from(porCliente.entries()).map(([id_control, valores]) => ({
    id_control, nombre: nombreMap.get(id_control) || id_control, valores,
    total: Object.values(valores).reduce((a, b) => a + b, 0),
  })).sort((a, b) => b.total - a.total).slice(0, topN);

  const series = entradas.map((e) => ({ id_control: e.id_control, nombre: e.nombre, total: e.total }));
  const puntos = claves.map((k) => {
    const punto: Record<string, number> = {};
    for (const e of entradas) punto[e.id_control] = e.valores[k] || 0;
    return punto;
  });
  return { meses, series, puntos };
}

// ── Evolución del precio promedio de venta (ARS final, IVA incluido, ponderado por unidades) — rúcula y lechuga por separado ──
// Solo se promedian ventas en la misma unidad (paquete/planta). Se excluyen bandeja_rucula,
// rucula_kg y lechuga_kg: son otra unidad de venta (bandeja o kg) con precio no comparable
// al de paquete/planta, y mezclarlos en el mismo promedio ponderado lo distorsiona hacia arriba.
const KEYS_RUCULA = ['rucula'] as const;
const KEYS_LECHUGA = ['lechuga_crespa', 'hoja_roble'] as const;
export interface PuntoPrecio { mes: string; label: string; precioRucula: number; precioLechuga: number }
export function evolucionPrecioPromedio(ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], n = 12): PuntoPrecio[] {
  const meses = ultimosNMeses(ventas, n);
  const clienteMap = new Map(clientes.map((c) => [c.id_control, c]));

  const promedioPonderado = (delMes: VentaDia[], keys: readonly string[]) => {
    let ingresos = 0, unidades = 0;
    for (const v of delMes) {
      const cliente = clienteMap.get(v.id_control);
      for (const key of keys) {
        const qty = Number((v as any)[key]) || 0;
        if (qty <= 0) continue;
        ingresos += qty * precioFinal(precios, v.id_control, v.sucursal, key, cliente);
        unidades += qty;
      }
    }
    return unidades > 0 ? Math.round((ingresos / unidades) * 100) / 100 : 0;
  };

  return meses.map((mes) => {
    const delMes = ventas.filter((v) => mesKey(v.fecha) === mes);
    return {
      mes, label: mesLabel(mes),
      precioRucula: promedioPonderado(delMes, KEYS_RUCULA),
      precioLechuga: promedioPonderado(delMes, KEYS_LECHUGA),
    };
  });
}

// ── Resumen de un mes: unidades vendidas, proyección (por proporción del mes
// transcurrido) y precio promedio — para la tarjeta de Indicadores.
// `fechaRef` fija el mes objetivo (por defecto hoy); `diaCorte` permite recortar ese mes
// hasta un día puntual (para comparar "lo que va del mes" contra el mismo tramo del mes
// pasado). Sin diaCorte usa el día de fechaRef (o el mes completo si fechaRef ya pasó).
export interface ResumenMesActual { unidadesMes: number; proyeccionMes: number; precioPromedioMes: number }
export function resumenMesActual(
  ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], fechaRef: Date = new Date(), diaCorte?: number
): ResumenMesActual {
  const mk = mesKey(fechaRef.toISOString().slice(0, 10));
  const corte = diaCorte ?? fechaRef.getDate();
  const delMes = ventas.filter((v) => {
    if (mesKey(v.fecha) !== mk) return false;
    const dia = Number(String(v.fecha).split(/[T ]/)[0].split('-')[2]);
    return !dia || dia <= corte;
  });
  const clienteMap = new Map(clientes.map((c) => [c.id_control, c]));

  const PRICE_KEYS = [...KEYS_RUCULA, ...KEYS_LECHUGA, 'albahaca'] as const;
  // rucula_kg/lechuga_kg (ventas por cajón) quedan afuera de "unidades": no solo es otra
  // unidad de venta (mismo motivo por el que ya se excluían del precio promedio), sino que
  // esos clientes suelen cargarse en uno o dos lotes grandes en vez de a diario. Si entran
  // a la suma, un cajón grande caído del lado equivocado del corte (día 15, fin de mes...)
  // dispara el % de "venta al día"/"proyectada" de forma completamente errática, aunque la
  // conversión a paquete-equivalente sea matemáticamente correcta — el problema no es la
  // conversión, es que ese volumen no se reparte día a día como el resto.
  const KEYS_EXCLUIDAS_UNIDADES = ['rucula_kg', 'lechuga_kg'] as const;
  let unidades = 0, ingresosComparables = 0, unidadesComparables = 0;
  for (const v of delMes) {
    const cliente = clienteMap.get(v.id_control);
    for (const key of PROD_KEYS) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      if (!(KEYS_EXCLUIDAS_UNIDADES as readonly string[]).includes(key)) unidades += qty;
      if ((PRICE_KEYS as readonly string[]).includes(key)) {
        ingresosComparables += qty * precioFinal(precios, v.id_control, v.sucursal, key, cliente);
        unidadesComparables += qty;
      }
    }
  }

  const diasEnMes = new Date(fechaRef.getFullYear(), fechaRef.getMonth() + 1, 0).getDate();
  const proyeccionMes = corte > 0 ? Math.round((unidades / corte) * diasEnMes) : 0;
  // Precio promedio final (IVA incluido): solo ventas por paquete/planta (mismo criterio
  // que evolucionPrecioPromedio) — mezclar bandeja/kg inflaba el promedio al combinar
  // unidades de venta distintas.
  const precioPromedioMes = unidadesComparables > 0 ? Math.round((ingresosComparables / unidadesComparables) * 100) / 100 : 0;
  return { unidadesMes: unidades, proyeccionMes, precioPromedioMes };
}

// ── Ventas por cultivo (unidades y $ final IVA incluido) en un rango de fechas [desde,hasta]
// inclusive (YYYY-MM-DD) — para el reporte semanal. Kg convertidos a paquete-equivalente. ──
export interface VentasRangoCultivo { unidades: number; monto: number }
export interface VentasRango { rucula: VentasRangoCultivo; lechuga: VentasRangoCultivo }
export function ventasEnRango(ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], desde: string, hasta: string): VentasRango {
  const clienteMap = new Map(clientes.map((c) => [c.id_control, c]));
  const acc: VentasRango = { rucula: { unidades: 0, monto: 0 }, lechuga: { unidades: 0, monto: 0 } };
  for (const v of ventas) {
    const f = String(v.fecha || '').split(/[T ]/)[0];
    if (!f || f < desde || f > hasta) continue;
    const cliente = clienteMap.get(v.id_control);

    for (const key of ['rucula', 'bandeja_rucula'] as const) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      acc.rucula.unidades += qty;
      acc.rucula.monto += qty * precioFinal(precios, v.id_control, v.sucursal, key, cliente);
    }
    const kgR = Number(v.rucula_kg) || 0;
    if (kgR > 0) {
      acc.rucula.unidades += Math.round((kgR * 1000) / GR_PAQ_RUCULA);
      acc.rucula.monto += kgR * precioFinal(precios, v.id_control, v.sucursal, 'rucula_kg', cliente);
    }

    for (const key of ['lechuga_crespa', 'hoja_roble'] as const) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      acc.lechuga.unidades += qty;
      acc.lechuga.monto += qty * precioFinal(precios, v.id_control, v.sucursal, key, cliente);
    }
    const kgL = Number(v.lechuga_kg) || 0;
    if (kgL > 0) {
      acc.lechuga.unidades += Math.round((kgL * 1000) / GR_PAQ_LECHUGA);
      acc.lechuga.monto += kgL * precioFinal(precios, v.id_control, v.sucursal, 'lechuga_kg', cliente);
    }
  }
  acc.rucula.monto = Math.round(acc.rucula.monto);
  acc.lechuga.monto = Math.round(acc.lechuga.monto);
  return acc;
}

function lunesDeSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}
const fmtISOLocal = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// ── Ventas por cultivo (unidades), últimas N semanas CALENDARIO completas (lunes a
// domingo, terminando el domingo pasado — la semana en curso queda afuera por estar
// incompleta). A diferencia de evolucionVentaPorArticuloSemanal, no depende de qué
// semanas tengan ventas cargadas: si hubo un hueco de carga, esa semana simplemente
// aparece en 0 en vez de saltarse silenciosamente a semanas más viejas para completar N,
// lo que corría las etiquetas y hacía parecer "actual" un dato de varios meses atrás. ──
export interface PuntoVentaCultivoSemana { semana: string; label: string; rucula: number; lechuga: number }
export function ventasPorCultivoUltimasSemanas(
  ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], n = 4
): PuntoVentaCultivoSemana[] {
  const lunesActual = lunesDeSemana(new Date());
  const puntos: PuntoVentaCultivoSemana[] = [];
  for (let i = n; i >= 1; i--) {
    const lunes = new Date(lunesActual); lunes.setDate(lunes.getDate() - i * 7);
    const domingo = new Date(lunes); domingo.setDate(domingo.getDate() + 6);
    const desde = fmtISOLocal(lunes), hasta = fmtISOLocal(domingo);
    const r = ventasEnRango(ventas, precios, clientes, desde, hasta);
    puntos.push({ semana: desde, label: `${String(lunes.getDate()).padStart(2, '0')}/${String(lunes.getMonth() + 1).padStart(2, '0')}`, rucula: r.rucula.unidades, lechuga: r.lechuga.unidades });
  }
  return puntos;
}
