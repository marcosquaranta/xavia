import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, readSheet, updateRow } from '@/lib/sheets';
import { generarIdSiembra, completarIdEnTrasplante } from '@/lib/loteId';
import { proximoIdMovimiento, codigoCultivo } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';

function diasEntre(desde: string, hasta: string): number {
  if (!desde || !hasta) return 0;
  try {
    const d1 = new Date(desde); const d2 = new Date(hasta);
    return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400000));
  } catch { return 0; }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const { id_lote, fecha, ubicacion_destino_id, tubos_ocupados, plantas_trasplantadas, plantas_quedan, descarte, fase_destino } = body;

    const [lotes, ubicaciones, movimientos] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Ubicacion>('Ubicaciones'),
      readSheet<Movimiento>('Movimientos'),
    ]);

    const lote = lotes.find((l) => l.id_lote === id_lote);
    if (!lote) return NextResponse.json({ error: 'lote_no_encontrado' }, { status: 404 });

    const ubicDestino = ubicaciones.find((u) => u.id_ubicacion === ubicacion_destino_id);
    if (!ubicDestino) return NextResponse.json({ error: 'ubicacion_no_encontrada' }, { status: 400 });

    const cultivo = codigoCultivo(lote.variedad);
    const esRucula = cultivo === 'R';
    const factorPlantines = esRucula ? 2 : 1;
    const plantasReales = Math.round(plantas_trasplantadas / factorPlantines);
    const plantasQuedanReales = Math.round((plantas_quedan || 0) / factorPlantines);
    const seDivide = plantas_quedan > 0 && plantas_trasplantadas > 0;

    const matchMesada = /M[LR]([12])/.exec(ubicDestino.id_ubicacion);
    const numMesada = matchMesada ? Number(matchMesada[1]) as 1 | 2 : 1;

    // Fechas previas para calcular días
    const movsLote = movimientos
      .filter((m) => m.id_lote === id_lote)
      .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

    const movSiembra = movsLote.find((m) => m.tipo === 'siembra');
    const movF1 = movsLote.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_1');
    const fechaSiembra = String(movSiembra?.fecha || lote.fecha_siembra || '');
    const fechaF1existente = String(movF1?.fecha || '');

    // Campos de análisis según fase destino
    const camposAnalisis: Record<string, any> = {};
    if (fase_destino === 'fase_1') {
      camposAnalisis.fecha_f1 = fecha;
      camposAnalisis.dias_plantinera = diasEntre(fechaSiembra, fecha);
    } else if (fase_destino === 'fase_2') {
      camposAnalisis.fecha_f2 = fecha;
      if (fechaF1existente) {
        camposAnalisis.dias_f1 = diasEntre(fechaF1existente, fecha);
      } else {
        camposAnalisis.dias_plantinera = diasEntre(fechaSiembra, fecha);
      }
    }

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
      }
      await updateRow('Lotes', 'id_lote', lote.id_lote, {
        ...(nuevoId !== lote.id_lote ? { id_lote: nuevoId } : {}),
        fase_actual: fase_destino,
        ubicacion_actual: ubicDestino.nombre,
        tubos_ocupados_actual: tubos_ocupados,
        plantas_estimadas_actual: plantasReales,
        plantines_iniciales: plantas_trasplantadas,
        fecha_ult_movimiento: fecha,
        ...camposAnalisis,
      });

      const idMov = await proximoIdMovimiento();
      await appendRow('Movimientos', [
        idMov, nuevoId, fecha, 'trasplante',
        lote.fase_actual, fase_destino,
        lote.ubicacion_actual, ubicDestino.nombre,
        tubos_ocupados, plantasReales,
        '', '', '', '', descarte || 0, descarte || 0,
        '', '', '', '', '', user.email, '',
        `Trasplante: ${tubos_ocupados} tubos, ${plantasReales} plantas`,
      ]);
      return NextResponse.json({ ok: true, id_lote_resultante: nuevoId });
    }

    // División
    const matchNave = /^N([12])/.exec(lote.id_lote);
    const naveOrigen = matchNave ? Number(matchNave[1]) as 1 | 2 : 1;
    const idProv = await generarIdSiembra(naveOrigen);
    const idNuevo = completarIdEnTrasplante(idProv, cultivo, numMesada);

    await updateRow('Lotes', 'id_lote', lote.id_lote, {
      plantines_iniciales: plantas_quedan,
      plantas_estimadas_actual: plantasQuedanReales,
      fecha_ult_movimiento: fecha,
      notas: (String(lote.notas || '') + ` [dividido ${fecha}: ${plantasReales} plantas → ${idNuevo}]`).trim(),
    });

    // Nuevo lote con orden exacto de columnas
    await appendRow('Lotes', [
      idNuevo,                    // id_lote
      lote.variedad,              // variedad
      lote.fecha_siembra,         // fecha_siembra
      plantas_trasplantadas,      // plantines_iniciales
      fase_destino,               // fase_actual
      ubicDestino.nombre,         // ubicacion_actual
      tubos_ocupados,             // tubos_ocupados_actual
      plantasReales,              // plantas_estimadas_actual
      fecha,                      // fecha_ult_movimiento
      camposAnalisis.fecha_f1 || '', // fecha_f1
      camposAnalisis.fecha_f2 || '', // fecha_f2
      '',                         // fecha_cosecha
      camposAnalisis.dias_plantinera || '', // dias_plantinera
      camposAnalisis.dias_f1 || '',         // dias_f1
      '',                         // dias_f2
      '',                         // dias_total
      '',                         // unidades_cosechadas
      '',                         // plantas_por_unidad_real
      '',                         // descarte_reportado
      '',                         // peso_muestra_kg
      '',                         // peso_total_estimado_kg
      user.email,                 // usuario_creador
      '',                         // foto_url
      lote.id_lote,               // lote_origen
      lote.semilla_id || '',      // semilla_id
      '',                         // destino_cosecha
      `Lote hijo de ${lote.id_lote}`, // notas
      'activo',                   // estado
    ]);

    const idMov = await proximoIdMovimiento();
    await appendRow('Movimientos', [
      idMov, idNuevo, fecha, 'trasplante',
      lote.fase_actual, fase_destino,
      lote.ubicacion_actual, ubicDestino.nombre,
      tubos_ocupados, plantasReales,
      '', '', '', '', descarte || 0, descarte || 0,
      '', '', '', '', '', user.email, '',
      `Trasplante con división desde ${lote.id_lote}: ${plantasReales} plantas`,
    ]);

    return NextResponse.json({ ok: true, id_lote_padre: lote.id_lote, id_lote_nuevo: idNuevo, dividido: true });

  } catch (err: any) {
    console.error('Error trasplantando:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
