import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { updateRow, asegurarColumna } from '@/lib/sheets';

// Marcar pagada una compra que estaba pendiente.
//
// Se guarda la fecha del pago en `fecha_pago` y NO se toca `fecha`, que es la de la compra.
//
// Son dos preguntas distintas: el resultado del mes usa la fecha de compra —el costo es del
// mes en que entró la mercadería— y los saldos de caja usan la del pago. Si al pagar se
// moviera `fecha`, una compra de septiembre pagada en octubre saldría del resultado de
// septiembre y aparecería en el de octubre, y los dos meses quedarían mal.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { id_gasto, fecha_pago, medio_pago } = await req.json();
    if (!id_gasto) return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    if (!medio_pago) return NextResponse.json({ error: 'falta_medio_pago' }, { status: 400 });
    const fecha = String(fecha_pago || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: 'fecha_invalida' }, { status: 400 });

    await asegurarColumna('Gastos', 'fecha_pago');
    const ok = await updateRow('Gastos', 'id_gasto', String(id_gasto), {
      estado_pago: '',
      fecha_pago: fecha,
      medio_pago,
    });
    if (!ok) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true, mensaje: 'Compra marcada como pagada.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
