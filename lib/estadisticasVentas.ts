import type { VentaDia, ClienteVenta, PrecioVenta } from './types';

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

// ── Evolución de venta por artículo (unidades: paquetes de rúcula, plantas de lechuga/albahaca) ──
export interface PuntoArticulo { mes: string; label: string; rucula: number; lechuga: number; albahaca: number }
export function evolucionVentaPorArticulo(ventas: VentaDia[], n = 12): PuntoArticulo[] {
  const meses = ultimosNMeses(ventas, n);
  return meses.map((mes) => {
    const delMes = ventas.filter((v) => mesKey(v.fecha) === mes);
    const rucula = delMes.reduce((a, v) => a + (Number(v.rucula) || 0) + (Number(v.bandeja_rucula) || 0), 0);
    const lechuga = delMes.reduce((a, v) => a + (Number(v.lechuga_crespa) || 0) + (Number(v.hoja_roble) || 0), 0);
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

// ── Evolución del precio promedio de venta (ARS, ponderado por unidades) — rúcula y lechuga por separado ──
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
        ingresos += qty * getPrecio(precios, v.id_control, v.sucursal, key, cliente?.sucursales);
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

// ── Resumen del mes en curso: unidades vendidas, proyección (por proporción del mes
// transcurrido) y precio promedio — para la tarjeta de Indicadores ──
export interface ResumenMesActual { unidadesMes: number; proyeccionMes: number; precioPromedioMes: number }
export function resumenMesActual(ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[]): ResumenMesActual {
  const hoy = new Date();
  const mk = mesKey(hoy.toISOString().slice(0, 10));
  const delMes = ventas.filter((v) => mesKey(v.fecha) === mk);
  const clienteMap = new Map(clientes.map((c) => [c.id_control, c]));

  const PRICE_KEYS = [...KEYS_RUCULA, ...KEYS_LECHUGA, 'albahaca'] as const;
  let unidades = 0, ingresosComparables = 0, unidadesComparables = 0;
  for (const v of delMes) {
    const cliente = clienteMap.get(v.id_control);
    for (const key of PROD_KEYS) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      unidades += qty;
      if ((PRICE_KEYS as readonly string[]).includes(key)) {
        ingresosComparables += qty * getPrecio(precios, v.id_control, v.sucursal, key, cliente?.sucursales);
        unidadesComparables += qty;
      }
    }
  }

  const diaDelMes = hoy.getDate();
  const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const proyeccionMes = diaDelMes > 0 ? Math.round((unidades / diaDelMes) * diasEnMes) : 0;
  // Precio promedio: solo ventas por paquete/planta (mismo criterio que evolucionPrecioPromedio) —
  // mezclar bandeja/kg inflaba el promedio al combinar unidades de venta distintas.
  const precioPromedioMes = unidadesComparables > 0 ? Math.round((ingresosComparables / unidadesComparables) * 100) / 100 : 0;
  return { unidadesMes: unidades, proyeccionMes, precioPromedioMes };
}
