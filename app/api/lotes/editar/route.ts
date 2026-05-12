import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      id_lote, fase_actual, estado, ubicacion_actual,
      plantas_estimadas_actual, tubos_ocupados_actual, notas,
      fechas,
    } = body;

    if (!id_lote) return NextResponse.json({ error: 'falta_id' }, { status: 400 });

    const updatesLote: Record<string, any> = {
      fase_actual, estado, ubicacion_actual,
      // Guardar en AMBOS campos para que no haya discrepancia
      plantas_estimadas_actual,
      plantines_iniciales: plantas_estimadas_actual,
      tubos_ocupados_actual, notas,
    };
    if (fechas?.siembra?.fecha) updatesLote.fecha_siembra = fechas.siembra.fecha;
    if (fechas?.cosecha?.fecha) updatesLote.fecha_cosecha = fechas.cosecha.fecha;

    await updateRow('Lotes', 'id_lote', id_lote, updatesLote);

    // Actualizar fechas en los movimientos correspondientes
    for (const mov of [fechas?.siembra, fechas?.f1, fechas?.f2, fechas?.cosecha]) {
      if (mov?.id && mov?.fecha) {
        await updateRow('Movimientos', 'id_movimiento', String(mov.id), { fecha: mov.fecha });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Error editando lote:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
