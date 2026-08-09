import type { CajonMovimiento, ClienteVenta, VentaDia } from './types';
import { GR_PAQ_RUCULA, GR_PAQ_LECHUGA } from './estadisticasVentas';

// Vive acá (y no en app/api/cajones/config/route.ts) porque un route.ts de Next solo
// puede exportar handlers HTTP y un puñado de opciones conocidas (GET, POST, config,
// revalidate, etc.) — cualquier otro export ahí rompe la validación de tipos de rutas
// que Next genera en el build.
export const DEFAULT_UNIDADES_POR_CAJON = 500;

export interface SaldoCajonCliente {
  id_control: string;
  nombre: string;
  entregados: number;
  devueltos: number;
  saldo: number; // en la calle = entregados - devueltos
  ultimoMovimiento: string | null; // fecha YYYY-MM-DD
  diasSinMovimiento: number | null;
}

// Saldo por cliente (cuántos cajones tiene cada uno "en la calle") a partir de todo el
// historial de movimientos — un simple acumulado entrega(+)/devolución(-), sin ventana de
// tiempo: los cajones no "vencen", quedan pendientes hasta que se devuelven.
export function saldoPorCliente(movimientos: CajonMovimiento[], clientes: ClienteVenta[], hoy: Date = new Date()): SaldoCajonCliente[] {
  const nombreMap = new Map(clientes.map(c => [c.id_control, c.nombre_display || c.nombre_xubio || c.id_control]));
  const acc = new Map<string, { entregados: number; devueltos: number; ultimo: string | null }>();
  for (const m of movimientos) {
    const id = String(m.id_control || '');
    if (!id) continue;
    const cant = Number(m.cantidad) || 0;
    if (!acc.has(id)) acc.set(id, { entregados: 0, devueltos: 0, ultimo: null });
    const r = acc.get(id)!;
    if (m.tipo === 'entrega') r.entregados += cant; else r.devueltos += cant;
    const f = String(m.fecha || '');
    if (f && (!r.ultimo || f > r.ultimo)) r.ultimo = f;
  }
  const hoyStr = hoy.toISOString().slice(0, 10);
  return Array.from(acc.entries()).map(([id_control, r]) => {
    const diasSinMovimiento = r.ultimo ? Math.max(0, Math.round((new Date(hoyStr + 'T12:00:00').getTime() - new Date(r.ultimo + 'T12:00:00').getTime()) / 86400000)) : null;
    return {
      id_control, nombre: nombreMap.get(id_control) || m_nombreFallback(movimientos, id_control) || id_control,
      entregados: r.entregados, devueltos: r.devueltos, saldo: r.entregados - r.devueltos,
      ultimoMovimiento: r.ultimo, diasSinMovimiento,
    };
  }).sort((a, b) => b.saldo - a.saldo);
}
function m_nombreFallback(movimientos: CajonMovimiento[], id_control: string): string | null {
  return movimientos.find(m => m.id_control === id_control)?.nombre_cliente || null;
}

// Unidades vendidas a un cliente (paquetes de rúcula + plantas de lechuga + kg
// convertidos a paquete/planta-equivalente con los mismos factores que el resto de la
// app) — base para estimar cuántos cajones "deberían" haber salido, dado un ratio
// configurable de unidades por cajón.
function unidadesVenta(v: VentaDia): number {
  const directas = (Number(v.rucula) || 0) + (Number(v.lechuga_crespa) || 0) + (Number(v.hoja_roble) || 0) + (Number(v.bandeja_rucula) || 0) + (Number(v.albahaca) || 0);
  const ruculaKgEnPaq = ((Number(v.rucula_kg) || 0) * 1000) / GR_PAQ_RUCULA;
  const lechugaKgEnPaq = (((Number(v.lechuga_kg) || 0) + (Number(v.lechuga_kg_crespa) || 0) + (Number(v.lechuga_kg_roble) || 0)) * 1000) / GR_PAQ_LECHUGA;
  return directas + ruculaKgEnPaq + lechugaKgEnPaq;
}

export interface TeoricoCajonCliente { id_control: string; unidadesVendidas: number; teorico: number }

// Cajones TEÓRICOS que debieron salir hacia cada cliente, según todo lo que se le vendió
// históricamente ÷ unidades por cajón configuradas — para comparar contra lo realmente
// registrado en "entregas" y detectar entregas no anotadas (o al revés).
export function teoricoPorCliente(ventas: VentaDia[], unidadesPorCajon: number): Map<string, TeoricoCajonCliente> {
  const acc = new Map<string, number>();
  for (const v of ventas) {
    const id = String(v.id_control || '');
    if (!id) continue;
    const u = unidadesVenta(v);
    if (u <= 0) continue;
    acc.set(id, (acc.get(id) || 0) + u);
  }
  const out = new Map<string, TeoricoCajonCliente>();
  for (const [id_control, unidadesVendidas] of acc) {
    out.set(id_control, { id_control, unidadesVendidas, teorico: unidadesPorCajon > 0 ? Math.round(unidadesVendidas / unidadesPorCajon) : 0 });
  }
  return out;
}

export interface AlertaCajon { id_control: string; nombre: string; saldo: number; diasSinMovimiento: number | null }

// Clientes que deben cajones (saldo > 0) y no tuvieron NINGÚN movimiento (ni entrega ni
// devolución) en más de `diasUmbral` — el caso que preocupa: se le siguen dejando
// cajones (o quedaron pendientes) y hace rato que no se hace un seguimiento.
export function alertasCajones(saldos: SaldoCajonCliente[], diasUmbral = 7): AlertaCajon[] {
  return saldos
    .filter(s => s.saldo > 0 && s.diasSinMovimiento !== null && s.diasSinMovimiento > diasUmbral)
    .map(s => ({ id_control: s.id_control, nombre: s.nombre, saldo: s.saldo, diasSinMovimiento: s.diasSinMovimiento }))
    .sort((a, b) => (b.diasSinMovimiento || 0) - (a.diasSinMovimiento || 0));
}
