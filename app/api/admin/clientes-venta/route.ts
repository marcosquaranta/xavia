import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRow, asegurarColumna, readSheet, updateRow } from '@/lib/sheets';
import type { ClienteVenta } from '@/lib/types';

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_control, ...fields } = await req.json();
    if (!id_control) return NextResponse.json({ error: 'id_control requerido' }, { status: 400 });
    // "orden" es un campo nuevo — se agrega solo a la hoja si todavía no existe, para
    // no romper el guardado la primera vez que se usa.
    if ('orden' in fields) await asegurarColumna('Clientes', 'orden');
    const updated = await updateRow('Clientes', 'id_control', String(id_control), fields);
    if (!updated) return NextResponse.json({ error: 'cliente_no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const { nombre_xubio, nombre_display, alias, tipo_factura, punto_venta, sucursales, precios } = body;

    if (!nombre_xubio || !tipo_factura || !punto_venta) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    const clientes = await readSheet<ClienteVenta>('Clientes');
    const maxId = clientes.reduce((acc, c) => Math.max(acc, Number(c.id_control) || 0), 0);
    const idControl = String(maxId + 1);

    await appendRow('Clientes', [
      idControl, nombre_xubio, nombre_display || nombre_xubio,
      alias || '', tipo_factura, punto_venta, sucursales || '', 'SI',
    ]);

    // Agregar precios: id_control, nombre_cliente, sucursal_obs, rucula, lechuga_crespa, hoja_roble, bandeja_rucula, albahaca
    if (precios) {
      await appendRow('Precios', [
        idControl,
        nombre_xubio,
        nombre_display || nombre_xubio,
        precios.rucula || 0,
        precios.lechuga_crespa || 0,
        precios.hoja_roble || 0,
        precios.bandeja_rucula || 0,
        precios.albahaca || 0,
      ]);
    }

    return NextResponse.json({ ok: true, id_control: idControl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
