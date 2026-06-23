import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, batchUpdateRows } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';
import { getClientesXubio, matchClienteXubio, emitirFactura, PRODUCTO_CODIGO } from '@/lib/xubio';

export const dynamic = 'force-dynamic';

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

// Emite a Xubio todas las ventas acumuladas (PENDIENTE), una factura por cliente
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const [clientes, precios, ventas] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'),
      readSheet<PrecioVenta>('Precios'),
      readSheet<VentaDia>('Ventas'),
    ]);
    const pendientes = ventas.filter(v => v.exportado === 'PENDIENTE');
    if (!pendientes.length) return NextResponse.json({ error: 'No hay ventas cargadas para facturar' }, { status: 400 });

    const clientesXubio = await getClientesXubio();

    // Agrupar por cliente
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
      if (!items.length) continue;

      const esA = cliente.tipo_factura === 'A';
      const res = await emitirFactura({ clienteId, esA, fecha: lineas[0].fecha, items });

      if (res.ok) {
        emitidas.push({ cliente: nombre, numero: res.numeroDocumento, cae: res.cae });
        await batchUpdateRows('Ventas', 'id_venta', lineas.map(l => ({
          keyValue: l.id_venta,
          updates: { exportado: res.numeroDocumento || 'FACTURADO' },
        })));
      } else {
        errores.push({ cliente: nombre, error: res.error || 'Error desconocido' });
      }
    }

    return NextResponse.json({ ok: true, emitidas, errores });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
