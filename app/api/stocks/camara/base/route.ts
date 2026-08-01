import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, readSheet } from '@/lib/sheets';
import type { StockCamara } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const { cultivo, fecha, tipo, cantidad_paq, notas } = await req.json();
    if (!cultivo || !fecha || !tipo || cantidad_paq === undefined) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    const registros = await readSheet<StockCamara>('StockCamara').catch(() => []);
    const maxId = registros.reduce((acc, r) => Math.max(acc, Number(String(r.id_registro).replace('CAM-', '')) || 0), 0);
    const id = `CAM-${String(maxId + 1).padStart(4, '0')}`;

    // Append por NOMBRE de columna (inmune al orden de columnas de la planilla).
    // El appendRow posicional anterior podía meter cultivo/fecha en columnas
    // equivocadas si el orden de la hoja no coincidía, dejando el registro "invisible".
    await appendRowObj('StockCamara', {
      id_registro: id,
      cultivo,
      fecha,
      tipo,
      cantidad_paq: Number(cantidad_paq),
      notas: notas || '',
      usuario: user.email,
      fecha_carga: new Date().toISOString().split('T')[0],
    });

    return NextResponse.json({ ok: true, id_registro: id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
