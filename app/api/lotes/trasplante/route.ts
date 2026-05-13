import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, readSheet, updateRow } from '@/lib/sheets';
import { generarIdSiembra, completarIdEnTrasplante } from '@/lib/loteId';
import { proximoIdMovimiento, codigoCultivo } from '@/lib/lotes';
import type { Lote, Ubicacion } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      id_lote, fecha, ubicacion_destino_id,
      tubos_ocupados,
      plantas_trasplantadas, // plantines totales (posiciones × factor)
      plantas_quedan,        // plantines que quedan en plantinera
      descarte, fase_destino,
    } = body;

    const [lotes, ubicaciones] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Ubicacion>('Ubicaciones'),
    ]);

    const lote = lotes.find((l) => l.id_lote === id_lote);
    if (!lote) return NextResponse.json({ error: 'lote_no_encontrado' }, { status: 404 });

    const ubicDestino = ubicaciones.find((u) => u.id_ubicacion === ubicacion_destino_id);
    if (!ubicDestino) return NextResponse.json({ error: 'ubicacion_no_encontrada' }, { status: 400 });

    const cultivo = codigoCultivo(lote.variedad);
    const esRucula = cultivo === 'R';

    // PLANTAS = posiciones ocupadas (lo que se ve en cosecha)
    // Para rúcula: plantines / 2 = plantas (posiciones)
    // Para lechuga: plantines = plantas
    const factorPlantines = esRucula ? 2 : 1;
    const plantasReales = Math.round(plantas_trasplantadas / factorPlantines);
    const plantasQuedanReales = Math.round((plantas_quedan || 0) / factorPlantines);

    const seDivide = plantas_quedan > 0 && plantas_trasplantadas > 0;

    const matchMesada = /M[LR]([12])/.exec(ubicDestino.id_ubicacion);
    const numMesada = matchMesada ? Number(matchMesada[1]) as 1 | 2 : 1;

    if (!seDivide) {
      let nuevoId = lote.id_lote;
      if (!/^N[12][LRA][12]-/.test(lote.id_lote)) {
        nuevoId = completarIdEnTrasplante(lote.id_lote, cultivo, numMesada);
      }
      if (nuevoId !== lote.id_lote) {
        const movs = await readSheet<{ id_movimiento: number; id_lote: string }>('Movimientos');
        for (const m of movs) {
          if (m.id_lote === lote.id_lote) {
            await updateRow('Movimientos', 'id_movimiento', String(m.id_movimiento), { id_lote: nuevoId });
          }
        }
        await updateRow('Lotes', 'id_lote', lote.id_lote, {
          id_lote: nuevoId,
          fase_actual: fase_destino,
          ubicacion_actual: ubicDestino.nombre,
          tubos_ocupados_actual: tubos_ocupados,
          plantas_estimadas_actual: plantasReales,  // plantas (posiciones)
          plantines_iniciales: plantas_trasplantadas, // plantines originales
          fecha_ult_movimiento: fecha,
        });
      } else {
        await updateRow('Lotes', 'id_lote', lote.id_lote, {
          fase_actual: fase_destino,
          ubicacion_actual: ubicDestino.nombre,
          tubos_ocupados_actual: tubos_ocupados,
          plantas_estimadas_actual: plantasReales,  // plantas (posiciones)
          plantines_iniciales: plantas_trasplantadas,
          fecha_ult_movimiento: fecha,
        });
      }
      const idMov = await proximoIdMovimiento();
      await appendRow('Movimientos', [
        idMov, nuevoId, fecha, 'trasplante',
        lote.fase_actual, fase_destino,
        lote.ubicacion_actual, ubicDestino.nombre,
        tubos_ocupados, plantasReales,
        '', '', '', '',
        descarte || 0, descarte || 0,
        '', '', '', '', '',
        user.email, '',
        `Trasplante completo: ${tubos_ocupados} tubos, ${plantasReales} plantas${esRucula ? ` (${plantas_trasplantadas} plantines)` : ''}`,
      ]);
      return NextResponse.json({ ok: true, id_lote_resultante: nuevoId });
    }

    // Trasplante con división
    const matchNave = /^N([12])/.exec(lote.id_lote);
    const naveOrigen = matchNave ? Number(matchNave[1]) as 1 | 2 : 1;
    const idProv = await generarIdSiembra(naveOrigen);
    const idNuevo = completarIdEnTrasplante(idProv, cultivo, numMesada);

    // Lote original: actualizar con las plantas que quedan (en plantines para plantinera)
    await updateRow('Lotes', 'id_lote', lote.id_lote, {
      plantines_iniciales: plantas_quedan,
      plantas_estimadas_actual: plantasQuedanReales,
      fecha_ult_movimiento: fecha,
      notas: (String(lote.notas || '') + ` [dividido ${fecha}: ${plantasReales} plantas → ${idNuevo}]`).trim(),
    });

    // Lote nuevo: guardar plantas reales (posiciones)
    await appendRow('Lotes', [
      idNuevo, lote.variedad, lote.fecha_siembra,
      plantas_trasplantadas, // plantines_iniciales original
      fase_destino, ubicDestino.nombre,
      tubos_ocupados,
      plantasReales,  // plantas_estimadas_actual = posiciones
      fecha, '', '', '', '', '', '',
      user.email, '', lote.id_lote, lote.semilla_id || '', '',
      `Lote hijo de ${lote.id_lote}`, 'activo',
    ]);

    const idMov = await proximoIdMovimiento();
    await appendRow('Movimientos', [
      idMov, idNuevo, fecha, 'trasplante',
      lote.fase_actual, fase_destino,
      lote.ubicacion_actual, ubicDestino.nombre,
      tubos_ocupados, plantasReales,
      '', '', '', '',
      descarte || 0, descarte || 0,
      '', '', '', '', '',
      user.email, '',
      `Trasplante con división desde ${lote.id_lote}: ${plantasReales} plantas`,
    ]);

    return NextResponse.json({ ok: true, id_lote_padre: lote.id_lote, id_lote_nuevo: idNuevo, dividido: true });

  } catch (err: any) {
    console.error('Error trasplantando:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
