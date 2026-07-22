import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRowObj, asegurarHoja, deleteRow, readSheet, updateRow } from '@/lib/sheets';
import type { PedidoFijo } from '@/lib/types';

const HEADERS = ['id_pedido_fijo', 'id_control', 'nombre_cliente', 'sucursal', 'dia_semana', 'rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'activo', 'notas'];

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const { id_control, nombre_cliente, sucursal, dia_semana, rucula, lechuga_crespa, hoja_roble, bandeja_rucula, albahaca, notas } = body;
    if (!id_control || dia_semana === undefined || dia_semana === null) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    await asegurarHoja('PedidosFijos', HEADERS);
    const pedidos = await readSheet<PedidoFijo>('PedidosFijos');
    const maxId = pedidos.reduce((acc, p) => Math.max(acc, parseInt(String(p.id_pedido_fijo).replace('PF-', '')) || 0), 0);
    const idNuevo = `PF-${String(maxId + 1).padStart(4, '0')}`;
    await appendRowObj('PedidosFijos', {
      id_pedido_fijo: idNuevo, id_control, nombre_cliente: nombre_cliente || '', sucursal: sucursal || '',
      dia_semana: Number(dia_semana), rucula: Number(rucula) || 0, lechuga_crespa: Number(lechuga_crespa) || 0,
      hoja_roble: Number(hoja_roble) || 0, bandeja_rucula: Number(bandeja_rucula) || 0, albahaca: Number(albahaca) || 0,
      activo: 'SI', notas: notas || '',
    });
    return NextResponse.json({ ok: true, id_pedido_fijo: idNuevo });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_pedido_fijo, ...fields } = await req.json();
    if (!id_pedido_fijo) return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    const ok = await updateRow('PedidosFijos', 'id_pedido_fijo', String(id_pedido_fijo), fields);
    if (!ok) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_pedido_fijo } = await req.json();
    if (!id_pedido_fijo) return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    const ok = await deleteRow('PedidosFijos', 'id_pedido_fijo', String(id_pedido_fijo));
    if (!ok) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
