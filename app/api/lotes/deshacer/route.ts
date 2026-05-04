// app/api/lotes/deshacer/route.ts
// Deshace el último movimiento de un lote (trasplante o cosecha).
// Restaura el estado anterior del lote a partir del movimiento anterior.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow, deleteRow } from '@/lib/sheets';
import type { Lote, Movimiento } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    const url = new URL('/login', req.url);
    return NextResponse.redirect(url, { status: 303 });
  }

  try {
    const formData = await req.formData();
    const idLote = String(formData.get('id_lote') || '');
    const idMovimiento = String(formData.get('id_movimiento') || '');

    if (!idLote || !idMovimiento) {
      return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
    }

    const [lotes, movimientos] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Movimiento>('Movimientos'),
    ]);

    const lote = lotes.find((l) => l.id_lote === idLote);
    if (!lote) {
      return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
    }

    // Movimientos de este lote ordenados por fecha
    const movsLote = movimientos
      .filter((m) => m.id_lote === idLote)
      .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

    const ultimoMov = movsLote[movsLote.length - 1];
    if (!ultimoMov || String(ultimoMov.id_movimiento) !== idMovimiento) {
      // El movimiento ya no es el último (quizás alguien hizo otro en el medio)
      return NextResponse.redirect(
        new URL(`/cultivos/${encodeURIComponent(idLote)}`, req.url),
        { status: 303 }
      );
    }

    const movAnterior = movsLote[movsLote.length - 2];

    // Determinar estado previo del lote a partir del movimiento anterior
    const faseAnterior = String(ultimoMov.fase_origen || 'plantin');
    const ubicAnterior = String(ultimoMov.ubicacion_origen || '');
    const plantasAnterior = Number(movAnterior?.plantas_estimadas) || Number(lote.plantines_iniciales) || 0;

    // Si el último movimiento era una cosecha, reactivamos el lote
    if (ultimoMov.tipo === 'cosecha') {
      await updateRow('Lotes', 'id_lote', idLote, {
        estado: 'activo',
        fase_actual: faseAnterior,
        ubicacion_actual: ubicAnterior,
        plantas_estimadas_actual: plantasAnterior,
        fecha_cosecha: '',
        unidades_cosechadas: '',
        descarte_reportado: '',
        peso_muestra_kg: '',
        peso_total_estimado_kg: '',
        destino_cosecha: '',
        fecha_ult_movimiento: movAnterior ? String(movAnterior.fecha) : String(lote.fecha_siembra),
      });
    } else if (ultimoMov.tipo === 'trasplante') {
      // Si era trasplante, volvemos a la fase y ubicación anteriores
      await updateRow('Lotes', 'id_lote', idLote, {
        fase_actual: faseAnterior,
        ubicacion_actual: ubicAnterior,
        tubos_ocupados_actual: '',
        plantas_estimadas_actual: plantasAnterior,
        plantines_iniciales: plantasAnterior,
        fecha_ult_movimiento: movAnterior ? String(movAnterior.fecha) : String(lote.fecha_siembra),
      });
    }

    // Borrar el movimiento deshecho
    await deleteRow('Movimientos', 'id_movimiento', idMovimiento);

    return NextResponse.redirect(
      new URL(`/cultivos/${encodeURIComponent(idLote)}`, req.url),
      { status: 303 }
    );
  } catch (err: any) {
    console.error('Error deshaciendo:', err);
    return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
  }
}
