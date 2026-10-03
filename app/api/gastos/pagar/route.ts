import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

// Marcar pagada una compra que estaba pendiente.
//
// Se actualiza la FECHA del gasto a la fecha real de pago, y el medio de pago por el que
// salió. Es lo que hace que la compra entre en el mes correcto: el gasto se registra cuando
// sale la plata, y si se dejara la fecha de la compra, un pago de octubre caería en el
// resultado de septiembre.
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

    const ok = await updateRow('Gastos', 'id_gasto', String(id_gasto), {
      estado_pago: '',
      fecha,
      medio_pago,
    });
    if (!ok) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true, mensaje: 'Compra marcada como pagada.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
