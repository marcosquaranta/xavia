import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, asegurarColumna, asegurarHoja, deleteRow, readSheet } from '@/lib/sheets';
import { saldoPorCliente } from '@/lib/cajones';
import type { CajonMovimiento, ClienteVenta } from '@/lib/types';

const HEADERS = ['id_movimiento', 'fecha', 'id_control', 'nombre_cliente', 'tipo', 'cantidad', 'usuario', 'notas', 'diferencia_paq'];

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const { fecha, id_control, nombre_cliente, tipo, cantidad, notas } = body;
    if (!fecha || !id_control || !tipo || cantidad === undefined || cantidad === null) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    if (tipo !== 'entrega' && tipo !== 'devolucion' && tipo !== 'ajuste') {
      return NextResponse.json({ error: 'tipo_invalido' }, { status: 400 });
    }
    // 'ajuste' es un conteo físico — 0 es un valor válido (el cliente no tiene ningún
    // cajón en la calle); entrega/devolución siguen necesitando una cantidad > 0.
    const cantidadNum = Number(cantidad);
    if (tipo === 'ajuste' ? !(cantidadNum >= 0) : !(cantidadNum > 0)) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    await asegurarHoja('CajonesMovimientos', HEADERS);
    await asegurarColumna('CajonesMovimientos', 'diferencia_paq');
    const [movimientos, clientes] = await Promise.all([
      readSheet<CajonMovimiento>('CajonesMovimientos'),
      readSheet<ClienteVenta>('Clientes').catch(() => []),
    ]);

    // Diferencia informativa (solo para 'ajuste'): contra el saldo teórico de ESTE cliente
    // hasta ahora, replay del historial completo — mismo criterio que saldoPorCliente().
    let diferencia_paq = 0;
    if (tipo === 'ajuste') {
      const saldoActual = saldoPorCliente(movimientos, clientes).find(s => s.id_control === String(id_control))?.saldo ?? 0;
      diferencia_paq = cantidadNum - saldoActual;
    }

    const maxId = movimientos.reduce((acc, m) => Math.max(acc, parseInt(String(m.id_movimiento).replace('CJ-', '')) || 0), 0);
    const idNuevo = `CJ-${String(maxId + 1).padStart(4, '0')}`;
    await appendRowObj('CajonesMovimientos', {
      id_movimiento: idNuevo, fecha, id_control, nombre_cliente: nombre_cliente || '',
      tipo, cantidad: cantidadNum, usuario: user.email, notas: notas || '', diferencia_paq,
    });
    return NextResponse.json({ ok: true, id_movimiento: idNuevo, diferencia_paq });
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
