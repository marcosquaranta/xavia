import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { deleteRow } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { id_gasto } = await req.json();
    if (!id_gasto) return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    const ok = await deleteRow('Gastos', 'id_gasto', id_gasto);
    if (!ok) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
