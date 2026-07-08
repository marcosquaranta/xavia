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

// ── Evolución de venta por cliente (unidades totales, top N + "Otros") ──
export interface SerieCliente { id_control: string; nombre: string; total: number }
export interface EvolucionClientes { meses: { mes: string; label: string }[]; series: SerieCliente[]; puntos: Record<string, number>[] }
export function evolucionVentaPorCliente(ventas: VentaDia[], clientes: ClienteVenta[], n = 12, topN = 6): EvolucionClientes {
  const mesesKeys = ultimosNMeses(ventas, n);
  const meses = mesesKeys.map((mes) => ({ mes, label: mesLabel(mes) }));
  const porCliente = new Map<string, Record<string, number>>();
  for (const v of ventas) {
    const mk = mesKey(v.fecha);
    if (!mesesKeys.includes(mk)) continue;
    const total = PROD_KEYS.reduce((a, k) => a + (Number((v as any)[k]) || 0), 0);
    if (total <= 0) continue;
    if (!porCliente.has(v.id_control)) porCliente.set(v.id_control, {});
    const rec = porCliente.get(v.id_control)!;
    rec[mk] = (rec[mk] || 0) + total;
  }
  const nombreMap = new Map(clientes.map((c) => [c.id_control, c.nombre_display || c.nombre_xubio || c.id_control]));
  let entradas = Array.from(porCliente.entries()).map(([id_control, valores]) => ({
    id_control, nombre: nombreMap.get(id_control) || id_control, valores,
    total: Object.values(valores).reduce((a, b) => a + b, 0),
  })).sort((a, b) => b.total - a.total);

  if (entradas.length > topN) {
    const top = entradas.slice(0, topN);
    const resto = entradas.slice(topN);
    const otrosValores: Record<string, number> = {};
    for (const e of resto) for (const [mk, v] of Object.entries(e.valores)) otrosValores[mk] = (otrosValores[mk] || 0) + v;
    top.push({ id_control: '__otros__', nombre: 'Otros', valores: otrosValores, total: Object.values(otrosValores).reduce((a, b) => a + b, 0) });
    entradas = top;
  }

  const series = entradas.map((e) => ({ id_control: e.id_control, nombre: e.nombre, total: e.total }));
  const puntos = mesesKeys.map((mk) => {
    const punto: Record<string, number> = {};
    for (const e of entradas) punto[e.id_control] = e.valores[mk] || 0;
    return punto;
  });
  return { meses, series, puntos };
}

// ── Evolución del precio promedio de venta (ARS, ponderado por unidades) ──
export interface PuntoPrecio { mes: string; label: string; precioPromedio: number }
export function evolucionPrecioPromedio(ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], n = 12): PuntoPrecio[] {
  const meses = ultimosNMeses(ventas, n);
  const clienteMap = new Map(clientes.map((c) => [c.id_control, c]));

  function getPrecio(id_control: string, sucursal: string, key: string, clienteSucursales?: string): number {
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

  return meses.map((mes) => {
    const delMes = ventas.filter((v) => mesKey(v.fecha) === mes);
    let ingresos = 0, unidades = 0;
    for (const v of delMes) {
      const cliente = clienteMap.get(v.id_control);
      for (const key of PROD_KEYS) {
        const qty = Number((v as any)[key]) || 0;
        if (qty <= 0) continue;
        ingresos += qty * getPrecio(v.id_control, v.sucursal, key, cliente?.sucursales);
        unidades += qty;
      }
    }
    return { mes, label: mesLabel(mes), precioPromedio: unidades > 0 ? Math.round((ingresos / unidades) * 100) / 100 : 0 };
  });
}
