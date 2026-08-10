import type { CajonMovimiento, ClienteVenta, VentaDia } from './types';
import { GR_PAQ_RUCULA, GR_PAQ_LECHUGA } from './estadisticasVentas';

// Vive acá (y no en app/api/cajones/config/route.ts) porque un route.ts de Next solo
// puede exportar handlers HTTP y un puñado de opciones conocidas (GET, POST, config,
// revalidate, etc.) — cualquier otro export ahí rompe la validación de tipos de rutas
// que Next genera en el build.
// Rúcula y lechuga entran distinto en un cajón (rúcula en paquetes chicos, lechuga en
// cabezas más grandes) — por eso son dos ratios configurables, no uno solo.
export const DEFAULT_UNIDADES_POR_CAJON_RUCULA = 20;
export const DEFAULT_UNIDADES_POR_CAJON_LECHUGA = 10;

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

// Unidades vendidas a un cliente, separadas por rúcula y lechuga (paquetes/plantas +
// kg convertidos a paquete/planta-equivalente con los mismos factores que el resto de la
// app) — base para estimar cuántos cajones "deberían" haber salido, con un ratio
// configurable por cultivo (rúcula y lechuga entran distinto en un cajón). Albahaca se
// cuenta del lado de lechuga (mismo tipo de cajón/volumen), no tiene ratio propio.
function unidadesRuculaVenta(v: VentaDia): number {
  const directas = (Number(v.rucula) || 0) + (Number(v.bandeja_rucula) || 0);
  const kgEnPaq = ((Number(v.rucula_kg) || 0) * 1000) / GR_PAQ_RUCULA;
  return directas + kgEnPaq;
}
function unidadesLechugaVenta(v: VentaDia): number {
  const directas = (Number(v.lechuga_crespa) || 0) + (Number(v.hoja_roble) || 0) + (Number(v.albahaca) || 0);
  const kgEnPaq = (((Number(v.lechuga_kg) || 0) + (Number(v.lechuga_kg_crespa) || 0) + (Number(v.lechuga_kg_roble) || 0)) * 1000) / GR_PAQ_LECHUGA;
  return directas + kgEnPaq;
}

export interface TeoricoCajonCliente {
  id_control: string;
  unidadesRucula: number; unidadesLechuga: number;
  teoricoRucula: number; teoricoLechuga: number;
  teorico: number; // total = teoricoRucula + teoricoLechuga
}

// Cajones TEÓRICOS que debieron salir hacia cada cliente, según todo lo que se le vendió
// históricamente ÷ unidades por cajón configuradas para cada cultivo — para comparar
// contra lo realmente registrado en "entregas" y detectar entregas no anotadas (o al revés).
export function teoricoPorCliente(ventas: VentaDia[], unidadesPorCajonRucula: number, unidadesPorCajonLechuga: number): Map<string, TeoricoCajonCliente> {
  const acc = new Map<string, { rucula: number; lechuga: number }>();
  for (const v of ventas) {
    const id = String(v.id_control || '');
    if (!id) continue;
    const r = unidadesRuculaVenta(v), l = unidadesLechugaVenta(v);
    if (r <= 0 && l <= 0) continue;
    if (!acc.has(id)) acc.set(id, { rucula: 0, lechuga: 0 });
    const cur = acc.get(id)!;
    cur.rucula += r; cur.lechuga += l;
  }
  const out = new Map<string, TeoricoCajonCliente>();
  for (const [id_control, { rucula, lechuga }] of acc) {
    const teoricoRucula = unidadesPorCajonRucula > 0 ? Math.round(rucula / unidadesPorCajonRucula) : 0;
    const teoricoLechuga = unidadesPorCajonLechuga > 0 ? Math.round(lechuga / unidadesPorCajonLechuga) : 0;
    out.set(id_control, { id_control, unidadesRucula: rucula, unidadesLechuga: lechuga, teoricoRucula, teoricoLechuga, teorico: teoricoRucula + teoricoLechuga });
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
