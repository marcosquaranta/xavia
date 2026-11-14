import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow, appendRow } from '@/lib/sheets';
import { proximoIdMovimiento } from '@/lib/movimientos';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { Lote } from '@/lib/types';

export const dynamic = 'force-dynamic';

// ── Descartar un lote entero ─────────────────────────────────────────────────────────
//
// Un lote se puede perder: se pasó de ciclo, se enfermó, no sirve. Hasta ahora no había
// forma de decirlo. Las opciones eran dos y ninguna servía:
//
//  · "Editar lote" y poner estado = descartado. Sacaba el lote de la mesada pero no dejaba
//    registro de cuántas plantas se perdieron: el descarte sale de los Movimientos, y
//    cambiar el estado a mano no genera ninguno. La pérdida desaparecía de las
//    estadísticas, que es justo donde tiene que verse.
//
//  · "Borrar lote". Es de admin, y además significa otra cosa: un lote borrado no cuenta
//    en NINGÚN cálculo. Sirve para una carga equivocada, no para una pérdida real.
//
// Lo que pasaba entonces es lo que contó Leo: cargaba el descarte por otro lado y el lote
// le seguía figurando en la mesada. La mesada ocupada por algo que ya no está es peor que
// un número mal: el planificador no la ofrece, y nadie siembra ahí.
//
// Esto deja las dos cosas dichas a la vez. El lote pasa a `descartado` —la ocupación de
// mesadas solo mira los activos, así que la mesada se libera sola— y se escribe un
// movimiento de cosecha con CERO unidades y todas las plantas como descarte. Es
// literalmente lo que pasó: de ese lote no salió nada.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const { id_lote, motivo, fecha } = await req.json();
    const idLote = String(id_lote || '').trim();
    if (!idLote) return NextResponse.json({ error: 'Falta el lote.' }, { status: 400 });
    // El motivo no es burocracia: un lote descartado sin explicación es un agujero en las
    // estadísticas que nadie va a poder interpretar dentro de tres meses.
    const razon = String(motivo || '').trim();
    if (!razon) return NextResponse.json({ error: 'Escribí por qué se descarta el lote.' }, { status: 400 });

    const lotes = await readSheet<Lote>('Lotes');
    const lote = lotes.find((l) => String(l.id_lote) === idLote);
    if (!lote) return NextResponse.json({ error: `No existe el lote ${idLote}.` }, { status: 404 });
    if (String(lote.estado) !== 'activo') {
      return NextResponse.json({ error: `El lote ${idLote} no está activo (está ${lote.estado}).` }, { status: 409 });
    }

    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? String(fecha) : fechaArgentinaHoy();
    const plantas = Number(lote.plantas_estimadas_actual) || Number(lote.plantines_iniciales) || 0;

    await updateRow('Lotes', 'id_lote', idLote, {
      estado: 'descartado',
      fecha_cosecha: dia,
      unidades_cosechadas: 0,
      descarte_reportado: plantas,
      fecha_ult_movimiento: dia,
      notas: [String(lote.notas || '').trim(), `Descartado el ${dia}: ${razon}`].filter(Boolean).join(' · '),
    });

    // Movimiento de tipo cosecha con todo en descarte. Es de donde las estadísticas leen la
    // pérdida (ver lib/descarte.ts): sin él, el lote desaparece de la mesada y de los
    // números al mismo tiempo, y un descarte invisible es un descarte que se repite.
    const idMov = await proximoIdMovimiento();
    await appendRow('Movimientos', [
      idMov, idLote, dia, 'cosecha',
      lote.fase_actual, '',
      lote.ubicacion_actual, '',
      lote.tubos_ocupados_actual || '',
      plantas, 0,
      '', '', '',
      plantas, plantas,
      '', '',
      '', '', '',
      user.email || lote.usuario_creador, '',
      `Lote descartado: ${razon}`,
    ]);

    return NextResponse.json({
      ok: true,
      plantas,
      mensaje: `Lote ${idLote} descartado: ${plantas} planta(s). La mesada ${lote.ubicacion_actual || ''} quedó libre.`.trim(),
    });
  } catch (e: any) {
    console.error('[lotes/descartar]', e);
    return NextResponse.json({ error: e?.message || 'No se pudo descartar el lote.' }, { status: 500 });
  }
}
