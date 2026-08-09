import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, asegurarHoja, deleteRow, readSheet } from '@/lib/sheets';
import type { CajonMovimiento } from '@/lib/types';

const HEADERS = ['id_movimiento', 'fecha', 'id_control', 'nombre_cliente', 'tipo', 'cantidad', 'usuario', 'notas'];

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const { fecha, id_control, nombre_cliente, tipo, cantidad, notas } = body;
    if (!fecha || !id_control || !tipo || !(Number(cantidad) > 0)) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    if (tipo !== 'entrega' && tipo !== 'devolucion') {
      return NextResponse.json({ error: 'tipo_invalido' }, { status: 400 });
    }
    await asegurarHoja('CajonesMovimientos', HEADERS);
    const movimientos = await readSheet<CajonMovimiento>('CajonesMovimientos');
    const maxId = movimientos.reduce((acc, m) => Math.max(acc, parseInt(String(m.id_movimiento).replace('CJ-', '')) || 0), 0);
    const idNuevo = `CJ-${String(maxId + 1).padStart(4, '0')}`;
    await appendRowObj('CajonesMovimientos', {
      id_movimiento: idNuevo, fecha, id_control, nombre_cliente: nombre_cliente || '',
      tipo, cantidad: Number(cantidad), usuario: user.email, notas: notas || '',
    });
    return NextResponse.json({ ok: true, id_movimiento: idNuevo });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_movimiento } = await req.json();
    if (!id_movimiento) return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    const ok = await deleteRow('CajonesMovimientos', 'id_movimiento', String(id_movimiento));
    if (!ok) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
