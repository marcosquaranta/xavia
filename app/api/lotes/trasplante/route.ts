// app/api/lotes/trasplante/route.ts
// Trasplanta un lote (parcial o total) a una nueva ubicación.
// Si queda parte en la ubicación actual y el usuario eligió "queda", divide el lote.
// Si eligió "descartar", el lote original se cierra con 0.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, readSheet, updateRow } from '@/lib/sheets';
import { generarIdSiembra, completarIdEnTrasplante } from '@/lib/loteId';
import { proximoIdMovimiento, codigoCultivo } from '@/lib/lotes';
import type { Lote, Ubicacion } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      id_lote,
      fecha,
      ubicacion_destino_id,
      tubos_ocupados,
      plantas_trasplantadas,
      plantas_quedan,
      descarte,
      fase_destino,
    } = body;

    const [lotes, ubicaciones] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Ubicacion>('Ubicaciones'),
    ]);

    const lote = lotes.find((l) => l.id_lote === id_lote);
    if (!lote) {
      return NextResponse.json({ error: 'lote_no_encontrado' }, { status: 404 });
    }

    const ubicDestino = ubicaciones.find(
      (u) => u.id_ubicacion === ubicacion_destino_id
    );
    if (!ubicDestino) {
      return NextResponse.json(
        { error: 'ubicacion_no_encontrada' },
        { status: 400 }
      );
    }

    const seDivide = plantas_quedan > 0 && plantas_trasplantadas > 0;
    const cultivo = codigoCultivo(lote.variedad);

    // Extraer numero de mesada del id de ubicacion (ej: N1-ML1-F1 → mesada 1)
    const matchMesada = /M[LR]([12])/.exec(ubicDestino.id_ubicacion);
    const numMesada = matchMesada ? (Number(matchMesada[1]) as 1 | 2) : 1;

    // === Caso 1: NO se divide (todo el lote pasa) ===
    if (!seDivide) {
      // Si el lote no tiene cultivo+mesada en su id (porque está en plantinera),
      // generamos el id completo
      let nuevoId = lote.id_lote;
      const tieneSufijo = /^N[12][LRA][12]-/.test(lote.id_lote);
      if (!tieneSufijo) {
        nuevoId = completarIdEnTrasplante(lote.id_lote, cultivo, numMesada);
      }

      // Si cambia el id, reemplazamos en Lotes y Movimientos
      if (nuevoId !== lote.id_lote) {
        const movimientos = await readSheet<{ id_movimiento: number; id_lote: string }>(
          'Movimientos'
        );
        for (const m of movimientos) {
          if (m.id_lote === lote.id_lote) {
            await updateRow('Movimientos', 'id_movimiento', String(m.id_movimiento), {
              id_lote: nuevoId,
            });
          }
        }
        await updateRow('Lotes', 'id_lote', lote.id_lote, {
          id_lote: nuevoId,
          fase_actual: fase_destino,
          ubicacion_actual: ubicDestino.nombre,
          tubos_ocupados_actual: tubos_ocupados,
          plantas_estimadas_actual: plantas_trasplantadas,
          fecha_ult_movimiento: fecha,
          // Importante: actualizo plantines_iniciales también para que refleje lo que
          // realmente arrancó esta etapa. Esto evita el bug de rúcula donde el lote
          // madre seguía mostrando los plantines originales después de un trasplante.
          plantines_iniciales: plantas_trasplantadas,
        });
      } else {
        await updateRow('Lotes', 'id_lote', lote.id_lote, {
          fase_actual: fase_destino,
          ubicacion_actual: ubicDestino.nombre,
          tubos_ocupados_actual: tubos_ocupados,
          plantas_estimadas_actual: plantas_trasplantadas,
          fecha_ult_movimiento: fecha,
        });
      }

      const idMov = await proximoIdMovimiento();
      await appendRow('Movimientos', [
        idMov,
        nuevoId,
        fecha,
        'trasplante',
        lote.fase_actual,
        fase_destino,
        lote.ubicacion_actual,
        ubicDestino.nombre,
        tubos_ocupados,
        plantas_trasplantadas,
        '',
        '',
        '',
        '',
        descarte || 0,
        descarte || 0,
        '',
        '',
        '',
        '',
        '',
        user.email,
        '',
        'Trasplante completo',
      ]);

      return NextResponse.json({ ok: true, id_lote_resultante: nuevoId });
    }

    // === Caso 2: SE DIVIDE ===
    // El lote original sigue con plantas_quedan en la ubicación actual.
    // Se crea un nuevo lote con id nuevo (a partir del correlativo de la nave).

    const matchNave = /^N([12])/.exec(lote.id_lote);
    const naveOrigen = matchNave ? (Number(matchNave[1]) as 1 | 2) : 1;

    // Generar nuevo id provisional y completarlo
    const idProvNuevo = await generarIdSiembra(naveOrigen);
    const idNuevoLote = completarIdEnTrasplante(idProvNuevo, cultivo, numMesada);

    // Actualizar el lote original (sigue en su ubicación, con menos plantas).
    // CLAVE: actualizar también plantines_iniciales para que la próxima vez que
    // se trasplante, el cálculo de "cantidad actual" sea correcto.
    await updateRow('Lotes', 'id_lote', lote.id_lote, {
      plantines_iniciales: plantas_quedan,
      plantas_estimadas_actual: plantas_quedan,
      fecha_ult_movimiento: fecha,
      notas: `${lote.notas || ''} [se dividió ${fecha}: ${plantas_trasplantadas} → ${idNuevoLote}]`.trim(),
    });

    // Crear nuevo lote (hijo)
    await appendRow('Lotes', [
      idNuevoLote,
      lote.variedad,
      lote.fecha_siembra,
      plantas_trasplantadas,
      fase_destino,
      ubicDestino.nombre,
      tubos_ocupados,
      plantas_trasplantadas,
      fecha,
      '',
      '',
      '',
      '',
      '',
      '',
      user.email,
      '',
      lote.id_lote, // lote_origen
      lote.semilla_id || '',
      '',
      `Lote hijo de ${lote.id_lote}`,
      'activo',
    ]);

    // Movimiento del trasplante (en el lote nuevo)
    const idMov = await proximoIdMovimiento();
    await appendRow('Movimientos', [
      idMov,
      idNuevoLote,
      fecha,
      'trasplante',
      lote.fase_actual,
      fase_destino,
      lote.ubicacion_actual,
      ubicDestino.nombre,
      tubos_ocupados,
      plantas_trasplantadas,
      '',
      '',
      '',
      '',
      descarte || 0,
      descarte || 0,
      '',
      '',
      '',
      '',
      '',
      user.email,
      '',
      `Trasplante con división desde ${lote.id_lote}`,
    ]);

    return NextResponse.json({
      ok: true,
      id_lote_padre: lote.id_lote,
      id_lote_nuevo: idNuevoLote,
      dividido: true,
    });
  } catch (err: any) {
    console.error('Error trasplantando:', err);
    return NextResponse.json(
      { error: err.message || 'server_error' },
      { status: 500 }
    );
  }
}
