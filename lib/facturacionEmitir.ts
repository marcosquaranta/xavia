import { readSheet, batchUpdateRows } from './sheets';
import type { ClienteVenta, PrecioVenta, VentaDia } from './types';
import { getClientesXubio, matchClienteXubio, emitirFactura, PRODUCTO_CODIGO } from './xubio';

const PROD_KEYS = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg'] as const;

function getPrecio(precios: PrecioVenta[], id_control: string, sucursal: string, key: string, clienteSucursales?: string): number {
  let row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal);
  if (!row && clienteSucursales) {
    for (const s of clienteSucursales.split('|').map(s => s.trim()).filter(Boolean)) {
      row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === s);
      if (row) break;
    }
  }
  if (!row) row = precios.find(p => String(p.id_control) === String(id_control));
  if (!row) return 0;
  return Number((row as any)[key] || 0);
}

export interface ResultadoEmision {
  emitidas: { cliente: string; numero?: string; cae?: string }[];
  errores: { cliente: string; error: string }[];
}

// Emite a Xubio las ventas PENDIENTE, una factura por cliente. Si idControls se pasa,
// solo emite esos clientes (los demás PENDIENTE quedan intactos). Las que fallan (ej.
// cliente no encontrado en Xubio) quedan como PENDIENTE para reintentar/arreglar desde
// la sección Facturación. Reutilizado por /api/facturacion/emitir y por la carga
// directa de ventas (/api/ventas/cargar).
export async function emitirPendientes(idControls?: string[] | null): Promise<ResultadoEmision> {
  const [clientes, precios, ventas] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    readSheet<PrecioVenta>('Precios'),
    readSheet<VentaDia>('Ventas'),
  ]);
  const idSet = idControls ? new Set(idControls) : null;
  const pendientes = ventas.filter(v => v.exportado === 'PENDIENTE' && (!idSet || idSet.has(String(v.id_control))));
  if (!pendientes.length) return { emitidas: [], errores: [] };

  const clientesXubio = await getClientesXubio();

  const porControl = new Map<string, VentaDia[]>();
  for (const v of pendientes) {
    const arr = porControl.get(v.id_control) || []; arr.push(v); porControl.set(v.id_control, arr);
  }

  const emitidas: { cliente: string; numero?: string; cae?: string }[] = [];
  const errores: { cliente: string; error: string }[] = [];

  for (const [idControl, lineas] of porControl) {
    const cliente = clientes.find(c => c.id_control === idControl);
    const nombre = cliente?.nombre_xubio || idControl;
    if (!cliente) { errores.push({ cliente: nombre, error: 'cliente no encontrado en la base local' }); continue; }

    const clienteId = matchClienteXubio(cliente.nombre_xubio, clientesXubio);
    if (!clienteId) { errores.push({ cliente: nombre, error: 'no se encontró el cliente en Xubio (revisá que el nombre coincida)' }); continue; }

    const items: { codigo: string; cantidad: number; precio: number; descripcion?: string }[] = [];
    for (const l of lineas) {
      for (const key of PROD_KEYS) {
        const qty = Number((l as any)[key]) || 0;
        if (qty <= 0) continue;
        const precio = getPrecio(precios, idControl, l.sucursal, key, cliente.sucursales);
        items.push({ codigo: PRODUCTO_CODIGO[key], cantidad: qty, precio, descripcion: l.sucursal || cliente.nombre_xubio });
      }
    }
    if (!items.length) {
      // No debería pasar (ya se filtró por cantidad>0 antes de marcar PENDIENTE), pero
      // si pasa no lo dejamos en silencio: sin esto, el cliente quedaba PENDIENTE para
      // siempre sin ningún rastro de error ni de éxito.
      errores.push({ cliente: nombre, error: 'sin productos con cantidad > 0 (revisar la carga de esta venta)' });
      continue;
    }

    const esA = cliente.tipo_factura === 'A';
    let res;
    try {
      res = await emitirFactura({ clienteId, esA, fecha: lineas[0].fecha, items });
    } catch (e: any) {
      console.error(`[facturacionEmitir] excepción emitiendo factura para ${nombre}:`, e);
      errores.push({ cliente: nombre, error: e?.message || 'excepción al emitir' });
      continue;
    }

    if (res.ok) {
      emitidas.push({ cliente: nombre, numero: res.numeroDocumento, cae: res.cae });
      await batchUpdateRows('Ventas', 'id_venta', lineas.map(l => ({
        keyValue: l.id_venta,
        updates: { exportado: res.numeroDocumento || 'FACTURADO' },
      })));
    } else {
      console.error(`[facturacionEmitir] Xubio rechazó la factura de ${nombre}:`, res.error);
      errores.push({ cliente: nombre, error: res.error || 'Error desconocido' });
    }
  }

  return { emitidas, errores };
}
