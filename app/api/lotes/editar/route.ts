import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { Lote, Movimiento } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const { id_lote, fase_actual, estado, ubicacion_actual, plantas_estimadas_actual, tubos_ocupados_actual, notas, fechas, peso_testigo_gr } = body;
    if (!id_lote) return NextResponse.json({ error: 'falta_id' }, { status: 400 });

    const lotes = await readSheet<Lote>('Lotes');
    const lote = lotes.find((l) => l.id_lote === id_lote);

    // Pesaje testigo obligatorio para marcar/mantener un lote como cosechado (salvo
    // destino cajón) — este endpoint es otra vía por la que un lote pasa a "cosechado"
    // (además de /api/lotes/cosecha), y se le había quedado sin exigir el peso.
    if (estado === 'cosechado' && lote?.destino_cosecha !== 'cajon') {
      const yaTenePeso = !!lote && (Number(lote.peso_muestra_paquete_gr) > 0 || Number(lote.peso_muestra_kg) > 0);
      if (!yaTenePeso && !(Number(peso_testigo_gr) > 0)) {
        return NextResponse.json({ error: 'El pesaje testigo (peso del paquete en gramos) es obligatorio para un lote cosechado' }, { status: 400 });
      }
    }

    const updatesLote: Record<string, any> = { fase_actual, estado, ubicacion_actual, plantas_estimadas_actual, tubos_ocupados_actual, notas };
    if (fechas?.siembra?.fecha) updatesLote.fecha_siembra = fechas.siembra.fecha;
    if (fechas?.cosecha?.fecha) updatesLote.fecha_cosecha = fechas.cosecha.fecha;

    // Pesaje testigo: es el peso pesado DIRECTAMENTE (del paquete o de la planta), nunca
    // se multiplica por la cantidad de plantas por paquete. Recalcula el total del lote
    // usando las unidades ya cosechadas (peso_muestra × unidades), sin otros factores.
    if (peso_testigo_gr !== undefined && Number(peso_testigo_gr) >= 0 && lote) {
      const v = String(lote.variedad || '').toLowerCase();
      const esRucula = v.includes('rucula') || v.includes('rúcula');
      const pesoKgUnidad = Number(peso_testigo_gr) / 1000;
      const unidades = Number(lote.unidades_cosechadas) || 0;
      if (esRucula) updatesLote.peso_muestra_paquete_gr = Number(peso_testigo_gr);
      else updatesLote.peso_muestra_kg = pesoKgUnidad;
      updatesLote.peso_total_estimado_kg = unidades > 0 ? (pesoKgUnidad * unidades).toFixed(3) : lote.peso_total_estimado_kg;
    }

    await updateRow('Lotes', 'id_lote', id_lote, updatesLote);
    for (const mov of [fechas?.siembra, fechas?.f1, fechas?.f2, fechas?.cosecha]) {
      if (mov?.id && mov?.fecha) {
        await updateRow('Movimientos', 'id_movimiento', String(mov.id), { fecha: mov.fecha });
      }
    }
    return NextResponse.json({ ok: true, id_lote_nuevo: id_lote });
  } catch (err: any) {
    console.error('Error editando lote:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
