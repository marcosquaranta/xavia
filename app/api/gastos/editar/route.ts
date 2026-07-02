import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';
import { CATEGORIAS_GASTO } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { id_gasto, fecha, descripcion, categoria, monto, medio_pago } = await req.json();
    if (!id_gasto) return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    const montoNum = Number(monto);
    if (!isFinite(montoNum) || montoNum <= 0) {
      return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
    }

    const ok = await updateRow('Gastos', 'id_gasto', id_gasto, {
      fecha, descripcion: String(descripcion || '').trim(),
      categoria: CATEGORIAS_GASTO.some((c) => c.value === categoria) ? categoria : 'gastos_generales',
      monto: montoNum, medio_pago,
    });
    if (!ok) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
