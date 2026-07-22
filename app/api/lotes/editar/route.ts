import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { Lote, Movimiento } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const {
      id_lote, fase_actual, estado, ubicacion_actual, plantas_estimadas_actual, tubos_ocupados_actual, notas, fechas, peso_testigo_gr,
      unidades_cosechadas, descarte_reportado,
    } = body;
    if (!id_lote) return NextResponse.json({ error: 'falta_id' }, { status: 400 });

    const lotes = await readSheet<Lote>('Lotes');
    const lote = lotes.find((l) => l.id_lote === id_lote);

    // Pesaje testigo obligatorio para marcar/mantener un lote como cosechado (salvo
    // destino cajón) — este endpoint es otra vía por la que un lote pasa a "cosechado"
    // (además de /api/lotes/cosecha), y se le había quedado sin exigir el peso.
    // OJO: también hay que bloquear que se lo BORRE en una edición posterior — antes,
    // si ya tenía un peso válido, la validación se salteaba entera y el recálculo de
    // más abajo aceptaba sin más un peso_testigo_gr en 0 mandado por error, dejando un
    // lote "cosechado" con cantidad cargada pero sin peso (justo lo que rompía el
    // gráfico de pesaje testigo en Estadísticas).
    if (estado === 'cosechado' && lote?.destino_cosecha !== 'cajon') {
      const yaTenePeso = !!lote && (Number(lote.peso_muestra_paquete_gr) > 0 || Number(lote.peso_muestra_kg) > 0);
      const pesoNuevoValido = Number(peso_testigo_gr) > 0;
      const seIntentaBorrarPeso = peso_testigo_gr !== undefined && !pesoNuevoValido;
      if ((!yaTenePeso || seIntentaBorrarPeso) && !pesoNuevoValido) {
        return NextResponse.json({ error: 'El pesaje testigo (peso del paquete en gramos) es obligatorio para un lote cosechado' }, { status: 400 });
      }
    }

    const updatesLote: Record<string, any> = { fase_actual, estado, ubicacion_actual, plantas_estimadas_actual, tubos_ocupados_actual, notas };
    if (fechas?.siembra?.fecha) updatesLote.fecha_siembra = fechas.siembra.fecha;
    if (fechas?.cosecha?.fecha) updatesLote.fecha_cosecha = fechas.cosecha.fecha;
    if (unidades_cosechadas !== undefined && Number(unidades_cosechadas) >= 0) updatesLote.unidades_cosechadas = Number(unidades_cosechadas);
    if (descarte_reportado !== undefined && Number(descarte_reportado) >= 0) updatesLote.descarte_reportado = Number(descarte_reportado);

    // Pesaje testigo: es el peso pesado DIRECTAMENTE (del paquete o de la planta), nunca
    // se multiplica por la cantidad de plantas por paquete. Recalcula el total del lote
    // con el peso y las unidades FINALES (las recién editadas si vinieron, si no las que
    // ya tenía) — antes solo recalculaba al tocar el peso, usando unidades viejas, y
    // quedaba mal si en la misma edición también se corregía la cantidad cosechada.
    if (lote) {
      const v = String(lote.variedad || '').toLowerCase();
      const esRucula = v.includes('rucula') || v.includes('rúcula');
      const pesoKgUnidadFinal = peso_testigo_gr !== undefined && Number(peso_testigo_gr) >= 0
        ? Number(peso_testigo_gr) / 1000
        : esRucula ? (Number(lote.peso_muestra_paquete_gr) || 0) / 1000 : Number(lote.peso_muestra_kg) || 0;
      if (peso_testigo_gr !== undefined && Number(peso_testigo_gr) >= 0) {
        if (esRucula) updatesLote.peso_muestra_paquete_gr = Number(peso_testigo_gr);
        else updatesLote.peso_muestra_kg = pesoKgUnidadFinal;
      }
      const unidadesFinal = updatesLote.unidades_cosechadas !== undefined ? updatesLote.unidades_cosechadas : Number(lote.unidades_cosechadas) || 0;
      if (pesoKgUnidadFinal > 0 && unidadesFinal > 0) {
        updatesLote.peso_total_estimado_kg = (pesoKgUnidadFinal * unidadesFinal).toFixed(3);
      }
    }

    await updateRow('Lotes', 'id_lote', id_lote, updatesLote);
    for (const mov of [fechas?.siembra, fechas?.f1, fechas?.f2, fechas?.cosecha]) {
      if (mov?.id && mov?.fecha) {
        await updateRow('Movimientos', 'id_movimiento', String(mov.id), { fecha: mov.fecha });
      }
    }
    // El movimiento de cosecha guarda su propia copia de unidades_cosechadas/descarte
    // (la usan Actividad y el resumen del Panel) — sin este paso quedaba desincronizado
    // del valor recién corregido en el lote.
    if (fechas?.cosecha?.id && (updatesLote.unidades_cosechadas !== undefined || updatesLote.descarte_reportado !== undefined)) {
      const movUpdates: Record<string, any> = {};
      if (updatesLote.unidades_cosechadas !== undefined) movUpdates.unidades_cosechadas = updatesLote.unidades_cosechadas;
      if (updatesLote.descarte_reportado !== undefined) { movUpdates.descarte_reportado = updatesLote.descarte_reportado; movUpdates.descarte_calculado = updatesLote.descarte_reportado; }
      await updateRow('Movimientos', 'id_movimiento', String(fechas.cosecha.id), movUpdates);
    }
    return NextResponse.json({ ok: true, id_lote_nuevo: id_lote });
  } catch (err: any) {
    console.error('Error editando lote:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
