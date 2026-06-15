import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, readSheet } from '@/lib/sheets';
import type { StockCamara } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  const { cultivo, fecha, tipo, cantidad_paq, notas } = await req.json();
  if (!cultivo || !fecha || !tipo || cantidad_paq === undefined) {
    return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
  }

  const registros = await readSheet<StockCamara>('StockCamara');
  const maxId = registros.reduce((acc, r) => Math.max(acc, Number(String(r.id_registro).replace('CAM-', '')) || 0), 0);
  const id = `CAM-${String(maxId + 1).padStart(4, '0')}`;

  await appendRow('StockCamara', [
    id, cultivo, fecha, tipo, Number(cantidad_paq), notas || '', user.email,
    new Date().toISOString().split('T')[0],
  ]);

  return NextResponse.json({ ok: true, id_registro: id });
}
