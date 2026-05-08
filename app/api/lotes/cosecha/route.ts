import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, readSheet, updateRow } from '@/lib/sheets';
import { proximoIdMovimiento, calcularDesvioCosecha } from '@/lib/lotes';
import type { Lote } from '@/lib/types';
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const { id_lote, fecha, es_por_paquete, plantas_cosechadas, descarte, peso_muestra_gr, paquetes_armados, plantas_por_paquete, peso_muestra_paquete_gr, bandejas_armadas, tubos_consumidos_bandejas, peso_muestra_bandeja_gr, plantas_estimadas_lote, usuario } = body;
    const lotes = await readSheet<Lote>('Lotes');
    const lote = lotes.find((l) => l.id_lote === id_lote);
    if (!lote) return NextResponse.json({ error: 'lote_no_encontrado' }, { status: 404 });
    const plantasEst = Number(plantas_estimadas_lote) || Number(lote.plantas_estimadas_actual) || Number(lote.plantines_iniciales) || 0;
    let unidades: number, plantasUsadas: number, pesoKg: number, descarteEf: number;
    if (!es_por_paquete) {
      unidades = Number(plantas_cosechadas) || 0;
      descarteEf = Math.max(0, plantasEst - unidades);
      plantasUsadas = unidades + descarteEf;
      pesoKg = (Number(peso_muestra_gr) || 0) > 0 ? (unidades * Number(peso_muestra_gr)) / 1000 : 0;
    } else {
      unidades = Number(paquetes_armados) || 0;
      plantasUsadas = plantasEst; descarteEf = 0;
      pesoKg = ((Number(peso_muestra_paquete_gr) || 0) * unidades + (Number(peso_muestra_bandeja_gr) || 0) * (Number(bandejas_armadas) || 0)) / 1000;
    }
    const { desvio, nivel } = calcularDesvioCosecha(plantasUsadas, plantasEst);
    const pesoMuestra = es_por_paquete ? (Number(peso_muestra_paquete_gr) || 0) / 1000 : (Number(peso_muestra_gr) || 0) / 1000;
    await updateRow('Lotes', 'id_lote', id_lote, { fecha_cosecha: fecha, unidades_cosechadas: unidades, plantas_por_unidad_real: es_por_paquete ? (Number(plantas_por_paquete) || 0) : 1, descarte_reportado: descarteEf, peso_muestra_kg: pesoMuestra, peso_total_estimado_kg: pesoKg > 0 ? pesoKg.toFixed(3) : '', destino_cosecha: es_por_paquete ? (Number(bandejas_armadas) > 0 ? 'bandeja' : 'paquete') : 'planta', estado: 'cosechado', fecha_ult_movimiento: fecha });
    const idMov = await proximoIdMovimiento();
    await appendRow('Movimientos', [idMov, id_lote, fecha, 'cosecha', lote.fase_actual, '', lote.ubicacion_actual, '', lote.tubos_ocupados_actual || '', plantasUsadas, unidades, es_por_paquete ? (Number(plantas_por_paquete) || 0) : '', tubos_consumidos_bandejas || '', bandejas_armadas || '', descarteEf, descarteEf, desvio, nivel, '', '', '', user || lote.usuario_creador, '', es_por_paquete ? 'Cosecha ' + unidades + ' paquetes' + (Number(bandejas_armadas) > 0 ? ' + ' + bandejas_armadas + ' bandejas' : '') : 'Cosecha ' + plantas_cosechadas + ' plantas']);
    return NextResponse.json({ ok: true });
  } catch (err: any) { console.error('Error cosechando:', err); return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 }); }
}