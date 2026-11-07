// ── Qué columnas de una fila de Ventas son mercadería ────────────────────────────────
//
// Esto existe porque la misma pregunta —"¿esta fila tiene algo vendido?"— se contestaba en
// seis lugares con la misma lista incompleta: PROD_KEYS, los artículos escritos en el
// código. Los artículos dados de alta desde Admin no estaban en esa lista, así que una
// venta de SOLO uno de ellos era invisible.
//
// No daba error en ningún lado, que es lo peor: la venta de Berro Hidropónico se cargaba
// bien, se veía en pantalla, y al mandarla a Xubio la app contestaba "no hay ventas para
// cargar en esa fecha". El filtro no la encontraba porque todas las columnas que miraba
// estaban en cero.
//
// La lista de artículos dejó de ser fija el día que se pudo crear uno desde Admin. Todo lo
// que recorra artículos tiene que preguntar acá, no escribirlos.

import { PROD_KEYS } from './articulos';
import { leerArticulosExtra } from './articulosVenta';

// Las ventas por kilo viven en columnas propias y no son artículos de la lista. Una venta
// solo por kilo también es una venta: dejarlas afuera del "¿tiene algo?" es el mismo error
// con otra ropa.
export const KEYS_KG = ['rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'] as const;

// Todas las claves de artículo: las del código más las dadas de alta en Admin.
export async function clavesDeArticulo(): Promise<string[]> {
  const extra = await leerArticulosExtra().catch(() => []);
  const vistas = new Set<string>(PROD_KEYS);
  for (const a of extra) if (a.key) vistas.add(a.key);
  return [...vistas];
}

// Artículos + kilos: todo lo que puede hacer que una fila tenga mercadería.
export async function clavesDeVenta(): Promise<string[]> {
  return [...(await clavesDeArticulo()), ...KEYS_KG];
}

export function tieneCantidad(v: any, claves: string[]): boolean {
  return claves.some((k) => (Number(v?.[k]) || 0) > 0);
}
