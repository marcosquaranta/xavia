// ── El id de cada fila de Ventas ─────────────────────────────────────────────────────
//
// El id era "el más alto que hay + 1", calculado después de leer la hoja. Dos guardados que
// llegan juntos —y llegan juntos: la pantalla guarda sola cada celda al salir de ella— leen
// la misma hoja, calculan el mismo número y escriben dos filas con el MISMO id.
//
// Desde ahí todo lo que escribe "por id" cae en la primera de las dos: se le cargaba a La
// Gallega y las cantidades iban a parar a la fila de otro cliente, la factura emitida se
// anotaba en una venta de otro día, y lo que se borraba no se borraba. Tres síntomas, un
// solo origen.
//
// Por eso el id ya no depende de lo que haya en la hoja: sale del reloj más un tramo al
// azar. Dos pedidos simultáneos no pueden coincidir.

import { readSheet, batchUpdateRows, filaDe } from './sheets';
import type { VentaDia } from './types';

export function nuevoIdVenta(): string {
  const azar = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, '0');
  return `V-${Date.now().toString(36).toUpperCase()}${azar}`;
}

// Ids repetidos que ya quedaron en la hoja: la primera fila conserva el suyo y a las demás
// se les da uno nuevo. Devuelve cuántas se corrigieron.
//
// Recibe las ventas ya leídas para no gastar una lectura cuando no hay nada que arreglar,
// que es casi siempre.
export async function repararIdsDuplicados(ventas: VentaDia[]): Promise<number> {
  const vistos = new Set<string>();
  const repetidas: VentaDia[] = [];
  for (const v of ventas) {
    const id = String(v.id_venta || '');
    if (!id) continue;
    if (vistos.has(id)) repetidas.push(v); else vistos.add(id);
  }
  const conFila = repetidas.filter((v) => filaDe(v));
  if (!conFila.length) return 0;
  await batchUpdateRows('Ventas', 'id_venta', conFila.map((v) => ({
    keyValue: String(v.id_venta), fila: filaDe(v), updates: { id_venta: nuevoIdVenta() },
  })));
  return conFila.length;
}

// Lee Ventas y, si había ids repetidos, los corrige y vuelve a leer. Lo que devuelve tiene
// siempre un id por fila.
export async function leerVentasConIdsUnicos(): Promise<VentaDia[]> {
  const ventas = await readSheet<VentaDia>('Ventas');
  const corregidas = await repararIdsDuplicados(ventas);
  if (!corregidas) return ventas;
  console.error(`[ventas] se corrigieron ${corregidas} fila(s) con id_venta repetido`);
  return readSheet<VentaDia>('Ventas');
}
