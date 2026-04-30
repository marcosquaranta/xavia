// app/api/lotes/cosecha/route.ts
// Registra la cosecha de un lote y lo marca como cosechado.
// Calcula desvíos y nivel de alerta (que el operario NO ve).

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
      cosechador,
      es_por_paquete,
      plantas_cosechadas,
      descarte,
      peso_muestra_kg,
      paquetes_armados,
      plantas_por_paquete,
      peso_muestra_paquete_kg,
      bandejas_armadas,
      tubos_consumidos_bandejas,
      peso_muestra_bandeja_kg,
      foto_url,
    } = body;

    if (!foto_url) {
      return NextResponse.json(
        { error: 'foto_obligatoria' },
        { status: 400 }
      );
    }

    const lotes = await readSheet<Lote>('Lotes');
    const lote = lotes.find((l) => l.id_lote === id_lote);
    if (!lote) {
      return NextResponse.json({ error: 'lote_no_encontrado' }, { status: 404 });
    }

    const plantasEsperadas = Number(lote.plantas_estimadas_actual) || 0;

    // Calcular cuántas unidades se cosecharon, peso total estimado, y desvío.
    let unidadesCosechadas: number;
    let plantasUsadasTotal: number;
    let pesoTotalEstimado: number;
    let descarteEfectivo: number;

    if (!es_por_paquete) {
      // Lechuga: por planta
      unidadesCosechadas = plantas_cosechadas;
      plantasUsadasTotal = plantas_cosechadas + (descarte || 0);
      pesoTotalEstimado = plantas_cosechadas * (peso_muestra_kg || 0);
      descarteEfectivo = descarte || 0;
    } else {
      // Rúcula/Albahaca: por paquete (+ bandejas opcionales)
      const plantasEnPaquetes = paquetes_armados * (plantas_por_paquete || 0);
      const plantasEnBandejas = (tubos_consumidos_bandejas || 0) * 30; // aprox
      // El cálculo correcto sería leer la ubicación y usar orificios_por_perfil,
      // pero a este nivel uno tiene el lote; el dato exacto se calculará en estadísticas.
      unidadesCosechadas = paquetes_armados;
      plantasUsadasTotal = plantasEnPaquetes + plantasEnBandejas;
      pesoTotalEstimado =
        paquetes_armados * (peso_muestra_paquete_kg || 0) +
        bandejas_armadas * (peso_muestra_bandeja_kg || 0);
      descarteEfectivo = Math.max(0, plantasEsperadas - plantasUsadasTotal);
    }

    const { desvio, nivel } = calcularDesvioCosecha(
      plantasUsadasTotal,
      plantasEsperadas
    );

    // Actualizar el lote como cosechado
    await updateRow('Lotes', 'id_lote', id_lote, {
      fase_actual: lote.fase_actual,
      fecha_cosecha: fecha,
      unidades_cosechadas: unidadesCosechadas,
      plantas_por_unidad_real: es_por_paquete ? plantas_por_paquete : 1,
      descarte_reportado: descarteEfectivo,
      peso_muestra_kg: es_por_paquete ? peso_muestra_paquete_kg : peso_muestra_kg,
      peso_total_estimado_kg: pesoTotalEstimado.toFixed(3),
      foto_url,
      destino_cosecha: es_por_paquete
        ? bandejas_armadas > 0
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
      lote.tubos_ocupados_actual,
      plantasUsadasTotal,
      unidadesCosechadas,
      es_por_paquete ? plantas_por_paquete : '',
      tubos_consumidos_bandejas || '',
      bandejas_armadas || '',
      descarteEfectivo,
      descarteEfectivo,
      desvio,
      nivel,
      '',
      '',
      cosechador,
      user.email,
      foto_url,
      es_por_paquete
        ? `Cosecha ${unidadesCosechadas} paquetes${
            bandejas_armadas ? ` + ${bandejas_armadas} bandejas` : ''
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
