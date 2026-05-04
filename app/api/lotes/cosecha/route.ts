// app/api/lotes/cosecha/route.ts
// Registra la cosecha de un lote y lo marca como cosechado.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, readSheet, updateRow } from '@/lib/sheets';
import { proximoIdMovimiento, calcularDesvioCosecha } from '@/lib/lotes';
import type { Lote } from '@/lib/types';

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
      es_por_paquete,
      plantas_cosechadas,
      descarte,
      peso_muestra_gr,        // gramos, opcional
      paquetes_armados,
      plantas_por_paquete,    // calculado automático en el form
      peso_muestra_paquete_gr,
      bandejas_armadas,
      tubos_consumidos_bandejas,
      peso_muestra_bandeja_gr,
      plantas_estimadas_lote, // lo manda el form para calcular descarte
    } = body;

    const lotes = await readSheet<Lote>('Lotes');
    const lote = lotes.find((l) => l.id_lote === id_lote);
    if (!lote) {
      return NextResponse.json({ error: 'lote_no_encontrado' }, { status: 404 });
    }

    const plantasEstimadas =
      Number(plantas_estimadas_lote) ||
      Number(lote.plantas_estimadas_actual) ||
      Number(lote.plantines_iniciales) ||
      0;

    let unidadesCosechadas: number;
    let plantasUsadasTotal: number;
    let pesoTotalEstimadoKg: number;
    let descarteEfectivo: number;

    if (!es_por_paquete) {
      // Lechuga: por planta
      unidadesCosechadas = Number(plantas_cosechadas) || 0;
      descarteEfectivo = Math.max(0, plantasEstimadas - unidadesCosechadas);
      plantasUsadasTotal = unidadesCosechadas + descarteEfectivo;
      // Convertir gramos a kg para guardar
      const pesoGr = Number(peso_muestra_gr) || 0;
      pesoTotalEstimadoKg =
        pesoGr > 0 ? (unidadesCosechadas * pesoGr) / 1000 : 0;
    } else {
      // Rúcula/Albahaca: por paquete (sin descarte)
      unidadesCosechadas = Number(paquetes_armados) || 0;
      plantasUsadasTotal = plantasEstimadas; // todas las plantas del lote
      descarteEfectivo = 0; // rúcula no tiene descarte
      const pesoGrPaq = Number(peso_muestra_paquete_gr) || 0;
      const pesoGrBand = Number(peso_muestra_bandeja_gr) || 0;
      pesoTotalEstimadoKg =
        (pesoGrPaq * unidadesCosechadas + pesoGrBand * (Number(bandejas_armadas) || 0)) / 1000;
    }

    // Calcular desvío (para alertas — el operario no lo ve)
    const { desvio, nivel } = calcularDesvioCosecha(plantasUsadasTotal, plantasEstimadas);

    // Peso de muestra a guardar en kg
    const pesoMuestraGuardar = es_por_paquete
      ? (Number(peso_muestra_paquete_gr) || 0) / 1000
      : (Number(peso_muestra_gr) || 0) / 1000;

    // Actualizar el lote como cosechado
    await updateRow('Lotes', 'id_lote', id_lote, {
      fecha_cosecha: fecha,
      unidades_cosechadas: unidadesCosechadas,
      plantas_por_unidad_real: es_por_paquete ? (Number(plantas_por_paquete) || 0) : 1,
      descarte_reportado: descarteEfectivo,
      peso_muestra_kg: pesoMuestraGuardar,
      peso_total_estimado_kg:
        pesoTotalEstimadoKg > 0 ? pesoTotalEstimadoKg.toFixed(3) : '',
      destino_cosecha: es_por_paquete
        ? Number(bandejas_armadas) > 0
          ? 'bandeja'
          : 'paquete'
        : 'planta',
      estado: 'cosechado',
      fecha_ult_movimiento: fecha,
    });

    // Movimiento de cosecha
    const idMov = await proximoIdMovimiento();
    await appendRow('Movimientos', [
      idMov,
      id_lote,
      fecha,
      'cosecha',
      lote.fase_actual,
      '',
      lote.ubicacion_actual,
      '',
      lote.tubos_ocupados_actual || '',
      plantasUsadasTotal,
      unidadesCosechadas,
      es_por_paquete ? (Number(plantas_por_paquete) || 0) : '',
      tubos_consumidos_bandejas || '',
      bandejas_armadas || '',
      descarteEfectivo,
      descarteEfectivo,
      desvio,
      nivel,
      '',
      '',
      '',
      user.email,
      '',
      es_por_paquete
        ? `Cosecha ${unidadesCosechadas} paquetes${
            Number(bandejas_armadas) > 0 ? ` + ${bandejas_armadas} bandejas` : ''
          }`
        : `Cosecha ${plantas_cosechadas} plantas`,
    ]);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Error cosechando:', err);
    return NextResponse.json(
      { error: err.message || 'server_error' },
      { status: 500 }
    );
  }
}
