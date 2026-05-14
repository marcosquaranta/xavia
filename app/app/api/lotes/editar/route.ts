import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import { generarIdCambioMesada } from '@/lib/loteId';
import type { Lote, Ubicacion, Movimiento } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      id_lote, fase_actual, estado, ubicacion_actual,
      plantas_estimadas_actual, tubos_ocupados_actual, notas, fechas,
    } = body;

    if (!id_lote) return NextResponse.json({ error: 'falta_id' }, { status: 400 });

    // Verificar si hay que actualizar el ID por cambio de mesada
    let idFinal = id_lote;
    const tieneIdCompleto = /^N[12][LRA][12]-/.test(id_lote);

    if (tieneIdCompleto && ubicacion_actual) {
      const [ubicaciones, lotes] = await Promise.all([
        readSheet<Ubicacion>('Ubicaciones'),
        readSheet<Lote>('Lotes'),
      ]);

      const ubic = ubicaciones.find((u) => u.nombre === ubicacion_actual);
      if (ubic && ubic.tipo === 'mesada') {
        const matchMesada = /M[LR]([12])/.exec(ubic.id_ubicacion);
        const numMesada = matchMesada ? Number(matchMesada[1]) as 1 | 2 : null;
        const matchIdActual = /^N[12][LRA]([12])-/.exec(id_lote);
        const mesadaActual = matchIdActual ? Number(matchIdActual[1]) as 1 | 2 : null;

        if (numMesada && mesadaActual && numMesada !== mesadaActual) {
          // La mesada cambió — calcular nuevo ID sin colisiones
          const todosLosIds = lotes.map((l) => l.id_lote).filter((id) => id !== id_lote);
          idFinal = await generarIdCambioMesada(id_lote, numMesada, todosLosIds);

          // Actualizar referencias en Movimientos
          const movimientos = await readSheet<Movimiento>('Movimientos');
          for (const m of movimientos) {
            if (m.id_lote === id_lote) {
              await updateRow('Movimientos', 'id_movimiento', String(m.id_movimiento), { id_lote: idFinal });
            }
          }
        }
      }
    }

    const updatesLote: Record<string, any> = {
      fase_actual, estado, ubicacion_actual,
      plantas_estimadas_actual, tubos_ocupados_actual, notas,
    };
    if (idFinal !== id_lote) updatesLote.id_lote = idFinal;
    if (fechas?.siembra?.fecha) updatesLote.fecha_siembra = fechas.siembra.fecha;
    if (fechas?.cosecha?.fecha) updatesLote.fecha_cosecha = fechas.cosecha.fecha;

    await updateRow('Lotes', 'id_lote', id_lote, updatesLote);

    // Actualizar fechas en movimientos
    for (const mov of [fechas?.siembra, fechas?.f1, fechas?.f2, fechas?.cosecha]) {
      if (mov?.id && mov?.fecha) {
        await updateRow('Movimientos', 'id_movimiento', String(mov.id), { fecha: mov.fecha });
      }
    }

    return NextResponse.json({ ok: true, id_lote_nuevo: idFinal });
  } catch (err: any) {
    console.error('Error editando lote:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
