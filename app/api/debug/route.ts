import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }
  try {
    const lotes = await readSheet<any>('Lotes');
    return NextResponse.json({
      total: lotes.length,
      columnas: lotes.length > 0 ? Object.keys(lotes[0]) : [],
      primeros_3: lotes.slice(0, 3).map((l: any) => ({
        id_lote: l.id_lote,
        estado: l.estado,
        fase_actual: l.fase_actual,
        variedad: l.variedad,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
