// app/api/lotes/editar/route.ts
// Edición manual del estado de un lote (sin crear movimiento).

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      id_lote,
      fase_actual,
      estado,
      ubicacion_actual,
      plantas_estimadas_actual,
      tubos_ocupados_actual,
      notas,
    } = body;

    if (!id_lote) {
      return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    }

    await updateRow('Lotes', 'id_lote', id_lote, {
      fase_actual,
      estado,
      ubicacion_actual,
      plantas_estimadas_actual,
      tubos_ocupados_actual,
      notas,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Error editando lote:', err);
    return NextResponse.json(
      { error: err.message || 'server_error' },
      { status: 500 }
    );
  }
}
