import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, appendRowObj, readSheet, updateRow } from '@/lib/sheets';
import { completarIdEnTrasplante, generarIdDivision } from '@/lib/loteId';
import { codigoCultivo } from '@/lib/lotes';
import { proximoIdMovimiento } from '@/lib/movimientos';
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
    // Albahaca va con 2 celdas por posición igual que la rúcula (misma espuma, mismo
    // armado en F2) — sin esto, el formulario (que elige el factor por la variedad de la
    // MESADA destino) mandaba plantines contados de a 2 y acá se guardaban como si fueran
    // 1 por posición, duplicando las plantas del lote de albahaca.
    const dosCeldasPorPosicion = cultivo === 'R' || cultivo === 'A';
    const factorPlantines = dosCeldasPorPosicion ? 2 : 1;
    const plantasReales = Math.round(plantas_trasplantadas / factorPlantines);
    const plantasQuedanReales = Math.round((plantas_quedan || 0) / factorPlantines);
    // Descarte declarado en el trasplante (mismo criterio que el resto del formulario:
    // rúcula entra en plantines, se pasa a plantas reales ÷2) — se acumula en
    // Lote.descarte_reportado para que Estadísticas (descarte por mes/cultivo) refleje
    // también lo perdido en plantinera→F1 y F1→F2, no solo en la cosecha. También se
    // escribe en plantas reales (no plantines) en Movimiento.descarte_calculado, para que
    // quede en la MISMA unidad que Movimiento.plantas_estimadas — si no, el % de descarte
    // por transición de fase (ficha del lote) salía mal en rúcula (÷2 de más).
    const descarteReal = Math.round((Number(descarte) || 0) / factorPlantines);
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
if (!/^N[12][LRA]-/.test(lote.id_lote)) {
  nuevoId = completarIdEnTrasplante(lote.id_lote, cultivo);
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
        ...(descarteReal > 0 ? { descarte_reportado: (Number(lote.descarte_reportado) || 0) + descarteReal } : {}),
        ...camposAnalisis,
      });

      const idMov = await proximoIdMovimiento();
      await appendRow('Movimientos', [
        idMov, nuevoId, fecha, 'trasplante',
        lote.fase_actual, fase_destino,
        lote.ubicacion_actual, ubicDestino.nombre,
        tubos_ocupados, plantasReales,
        '', '', '', '', descarteReal || 0, descarteReal || 0,
        '', '', '', '', '', user.email, '',
        `Trasplante: ${tubos_ocupados} tubos, ${plantasReales} plantas`,
      ]);
      return NextResponse.json({ ok: true, id_lote_resultante: nuevoId });
    }

    // División — generar ID hijo sin mesada
    const todosLosIds = (await readSheet<any>('Lotes')).map((l: any) => l.id_lote);
    // Aseguramos que el ID padre esté completo antes de dividir
    const idPadreCompleto = /^N[12][LRA]-/.test(lote.id_lote)
      ? lote.id_lote
      : completarIdEnTrasplante(lote.id_lote, cultivo);
    const idNuevo = await generarIdDivision(idPadreCompleto, todosLosIds.filter((id: string) => id !== lote.id_lote));

    // Si el padre queda en plantinera (fase_actual sigue 'plantin'), la cantidad real
    // vive en plantines_iniciales — NO escribir plantas_estimadas_actual ahí (esa
    // columna es en posiciones/tubos, otra unidad). Escribirla con un valor > 0
    // hacía que se leyera esa cantidad equivocada (la mitad, en rúcula) en vez de
    // plantines_iniciales al querer trasplantar el resto del lote más adelante.
    await updateRow('Lotes', 'id_lote', lote.id_lote, {
      plantines_iniciales: plantas_quedan,
      plantas_estimadas_actual: lote.fase_actual === 'plantin' ? '' : plantasQuedanReales,
      fecha_ult_movimiento: fecha,
      notas: (String(lote.notas || '') + ` [dividido ${fecha}: ${plantasReales} plantas → ${idNuevo}]`).trim(),
    });

    // Nuevo lote por NOMBRE de columna (inmune al orden de la planilla)
    await appendRowObj('Lotes', {
      id_lote: idNuevo,
      variedad: lote.variedad,
      fecha_siembra: lote.fecha_siembra,
      plantines_iniciales: plantas_trasplantadas,
      fase_actual: fase_destino,
      ubicacion_actual: ubicDestino.nombre,
      tubos_ocupados_actual: tubos_ocupados,
      plantas_estimadas_actual: plantasReales,
      fecha_ult_movimiento: fecha,
      fecha_f1: camposAnalisis.fecha_f1 || '',
      fecha_f2: camposAnalisis.fecha_f2 || '',
      dias_plantinera: camposAnalisis.dias_plantinera || '',
      dias_f1: camposAnalisis.dias_f1 || '',
      usuario_creador: user.email,
      lote_origen: lote.id_lote,
      semilla_id: lote.semilla_id || '',
      // El descarte declarado en esta división queda con el lote hijo (es el que sigue
      // su ciclo hasta cosecharse) — el padre acumula el suyo por separado en sus propios
      // trasplantes/cosecha futuros.
      descarte_reportado: descarteReal > 0 ? descarteReal : '',
      notas: `Lote hijo de ${lote.id_lote}`,
      estado: 'activo',
    });

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

    // Movimiento espejo en el lote PADRE (antes solo quedaba una nota de texto en
    // lote.notas — no aparecía en "Historial de movimientos" porque ese único registro
    // de trasplante se grababa con id_lote = idNuevo, no con el del padre). Tipo propio
    // 'division' (no 'trasplante': no hay cambio de fase real acá, y así el botón
    // "Deshacer último" — que sólo actúa sobre trasplante/cosecha — no ofrece deshacer
    // esto a medias sin revertir también el lote hijo ya creado).
    const idMovPadre = await proximoIdMovimiento();
    await appendRow('Movimientos', [
      idMovPadre, lote.id_lote, fecha, 'division',
      '', '', '', '',
      '', plantasQuedanReales,
      '', '', '', '', '', '',
      '', '', '', '', '', user.email, '',
      `División: quedan ${plantasQuedanReales} plantas en este lote · ${plantasReales} trasplantadas → ${idNuevo}`,
    ]);

    return NextResponse.json({ ok: true, id_lote_padre: lote.id_lote, id_lote_nuevo: idNuevo, dividido: true });

  } catch (err: any) {
    console.error('Error trasplantando:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
