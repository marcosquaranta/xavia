import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';
import { CATEGORIAS_GASTO, admiteMontoNegativo } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { id_gasto, fecha, descripcion, categoria, monto, medio_pago, cantidad } = await req.json();
    if (!id_gasto) return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    const montoNum = Number(monto);
    if (!isFinite(montoNum) || montoNum === 0 || (montoNum < 0 && !admiteMontoNegativo(categoria))) {
      return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
    }

    const ok = await updateRow('Gastos', 'id_gasto', id_gasto, {
      fecha, descripcion: String(descripcion || '').trim(),
      categoria: CATEGORIAS_GASTO.some((c) => c.value === categoria) ? categoria : 'gastos_generales',
      monto: montoNum, medio_pago,
      // La cantidad solo se toca si vino en el pedido: la edición desde Gastos no la manda,
      // y pisarla con 0 convertiría una compra de 40 bolsas en una compra sin cantidad —y
      // con eso se perdería el precio unitario, que se calcula dividiendo por ella.
      ...(cantidad !== undefined ? { cantidad: Number(cantidad) || 0 } : {}),
    });
    if (!ok) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
