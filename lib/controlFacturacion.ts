// ── Control: ventas que no llegaron a la factura ─────────────────────────────────────
//
// Una venta cargada puede quedarse en el camino de dos formas, y las dos son silenciosas:
//
//   · PENDIENTE — está en la cola de facturación pero nadie apretó el botón, o falló al
//     emitir (cliente que no matchea en Xubio, fecha rechazada, límite de Sheets).
//   · BORRADOR (exportado vacío) — se cargó y ni siquiera entró a la cola. Es la peor de
//     las dos: no aparece en ninguna pantalla de facturación, así que puede quedarse ahí
//     para siempre sin que nadie la busque.
//
// En los dos casos la mercadería salió y la plata no se facturó. Por eso esto va al reporte
// semanal: el viernes es el momento en que todavía se puede corregir la semana.

import type { VentaDia, PrecioVenta, ClienteVenta } from './types';
import { nombreClienteVisible } from './clientes';

const PROD_KEYS = [
  'rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca',
  'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble',
] as const;

// Desde cuántos días de atraso deja de ser "lo de hoy todavía sin facturar" y pasa a ser un
// problema. Dos días cubre el fin de semana sin gritar por algo normal.
export const DIAS_ATRASO_AVISO = 2;

export interface ClienteSinFacturar {
  id_control: string;
  cliente: string;
  ventas: number;        // filas de la hoja Ventas
  dias: number;          // días distintos
  diaMasViejo: string;   // YYYY-MM-DD
  atraso: number;        // días desde el más viejo
  unidades: number;
  monto: number;
}

export interface ControlFacturacion {
  pendientes: ClienteSinFacturar[];
  borradores: ClienteSinFacturar[];
  montoPendiente: number;
  montoBorrador: number;
  atrasoMax: number;
  hayProblema: boolean;
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

function precioDe(precios: PrecioVenta[], idControl: string, sucursal: string, key: string, sucursalesCliente?: string): number {
  let row = precios.find(p => String(p.id_control) === String(idControl) && p.sucursal_obs === sucursal);
  if (!row && sucursalesCliente) {
    for (const s of sucursalesCliente.split('|').map(x => x.trim()).filter(Boolean)) {
      row = precios.find(p => String(p.id_control) === String(idControl) && p.sucursal_obs === s);
      if (row) break;
    }
  }
  if (!row) row = precios.find(p => String(p.id_control) === String(idControl));
  return row ? Number((row as any)[key] || 0) : 0;
}

function agrupar(
  filas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], hoy: string,
): ClienteSinFacturar[] {
  const mapa = new Map<string, ClienteSinFacturar & { fechas: Set<string> }>();
  for (const v of filas) {
    const id = String(v.id_control || '');
    if (!id) continue;
    const cliente = clientes.find(c => String(c.id_control) === id);
    if (!mapa.has(id)) {
      mapa.set(id, {
        id_control: id, cliente: nombreClienteVisible(cliente) || v.nombre_cliente || id,
        ventas: 0, dias: 0, diaMasViejo: '', atraso: 0, unidades: 0, monto: 0, fechas: new Set(),
      });
    }
    const g = mapa.get(id)!;
    const f = soloFecha(v.fecha);
    let tieneAlgo = false;
    for (const key of PROD_KEYS) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      tieneAlgo = true;
      g.unidades += qty;
      g.monto += qty * precioDe(precios, id, v.sucursal, key, cliente?.sucursales);
    }
    // Una fila sin ninguna cantidad no es una venta sin facturar, es una fila vacía: no
    // suma al control ni hace que un cliente aparezca en la lista por nada.
    if (!tieneAlgo) continue;
    g.ventas++;
    if (f) g.fechas.add(f);
    if (f && (!g.diaMasViejo || f < g.diaMasViejo)) g.diaMasViejo = f;
  }
  const dias = (desde: string) =>
    desde ? Math.round((new Date(hoy + 'T12:00:00').getTime() - new Date(desde + 'T12:00:00').getTime()) / 86400000) : 0;
  return [...mapa.values()]
    .filter(g => g.ventas > 0)
    .map(({ fechas, ...g }) => ({ ...g, dias: fechas.size, atraso: dias(g.diaMasViejo) }))
    .sort((a, b) => b.atraso - a.atraso || b.monto - a.monto);
}

export function controlFacturacion(
  ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], hoy: string,
): ControlFacturacion {
  const pendientes = agrupar(ventas.filter(v => v.exportado === 'PENDIENTE'), precios, clientes, hoy);
  const borradores = agrupar(ventas.filter(v => !String(v.exportado || '').trim()), precios, clientes, hoy);
  const montoPendiente = pendientes.reduce((a, g) => a + g.monto, 0);
  const montoBorrador = borradores.reduce((a, g) => a + g.monto, 0);
  const atrasoMax = Math.max(0, ...pendientes.map(g => g.atraso), ...borradores.map(g => g.atraso));
  return {
    pendientes, borradores, montoPendiente, montoBorrador, atrasoMax,
    // Que hoy quede algo sin facturar es normal; que tenga días encima, no.
    hayProblema: atrasoMax >= DIAS_ATRASO_AVISO && (pendientes.length > 0 || borradores.length > 0),
  };
}
