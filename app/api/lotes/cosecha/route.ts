import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, appendRowObj, readSheet, updateRow } from '@/lib/sheets';
import { calcularDesvioCosecha, codigoCultivo } from '@/lib/lotes';
import { proximoIdMovimiento } from '@/lib/movimientos';
import { generarIdDivision, completarIdEnTrasplante } from '@/lib/loteId';
import type { Lote, Movimiento } from '@/lib/types';

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
    const {
      id_lote, fecha, modo, es_por_paquete,
      plantas_cosechadas, descarte,
      peso_muestra_gr,
      paquetes_armados, plantas_por_paquete,
      peso_muestra_paquete_gr,
      bandejas_armadas, tubos_consumidos_bandejas,
      peso_muestra_bandeja_gr,
      cajones_armados, kg_por_cajon, peso_total_kg_cajon,
      plantas_estimadas_lote, usuario,
    } = body;
    const modoFinal: 'planta' | 'paquete' | 'cajon' = modo || (es_por_paquete ? 'paquete' : 'planta');

    const [lotes, movimientos] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Movimiento>('Movimientos'),
    ]);

    const lote = lotes.find((l) => l.id_lote === id_lote);
    if (!lote) return NextResponse.json({ error: 'lote_no_encontrado' }, { status: 404 });

    const plantasEst = Number(plantas_estimadas_lote) || Number(lote.plantas_estimadas_actual) || Number(lote.plantines_iniciales) || 0;

    let unidades: number, plantasUsadas: number, pesoKg: number, descarteEf: number;
    if (modoFinal === 'planta') {
      unidades = Number(plantas_cosechadas) || 0;
      descarteEf = Math.max(0, plantasEst - unidades);
      plantasUsadas = unidades + descarteEf;
      pesoKg = (Number(peso_muestra_gr) || 0) > 0 ? (unidades * Number(peso_muestra_gr)) / 1000 : 0;
    } else if (modoFinal === 'cajon') {
      unidades = Number(cajones_armados) || 0;
      plantasUsadas = plantasEst;
      descarteEf = 0;
      pesoKg = Number(peso_total_kg_cajon) || (unidades * (Number(kg_por_cajon) || 0));
    } else {
      unidades = Number(paquetes_armados) || 0;
      plantasUsadas = plantasEst;
      descarteEf = 0;
      pesoKg = ((Number(peso_muestra_paquete_gr) || 0) * unidades + (Number(peso_muestra_bandeja_gr) || 0) * (Number(bandejas_armadas) || 0)) / 1000;
    }

    const { desvio, nivel } = calcularDesvioCosecha(plantasUsadas, plantasEst);
    const pesoMuestra = modoFinal === 'paquete'
      ? (Number(peso_muestra_paquete_gr) || 0) / 1000
      : modoFinal === 'cajon'
        ? (Number(kg_por_cajon) || 0)
        : (Number(peso_muestra_gr) || 0) / 1000;

    // Calcular días por fase para análisis
    const movsLote = movimientos
      .filter((m) => m.id_lote === id_lote)
      .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

    const movSiembra = movsLote.find((m) => m.tipo === 'siembra');
    const movF1 = movsLote.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_1');
    const movF2 = movsLote.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_2');

    const fechaSiembra = String(movSiembra?.fecha || lote.fecha_siembra || '');
    const fechaF1 = String(movF1?.fecha || '');
    const fechaF2 = String(movF2?.fecha || '');

    // Días por fase
    const diasPlantinera = fechaF1
      ? diasEntre(fechaSiembra, fechaF1)
      : fechaF2
        ? diasEntre(fechaSiembra, fechaF2)
        : diasEntre(fechaSiembra, fecha);

    const diasF1 = fechaF1
      ? diasEntre(fechaF1, fechaF2 || fecha)
      : 0;

    const diasF2 = fechaF2
      ? diasEntre(fechaF2, fecha)
      : 0;

    const diasTotal = diasEntre(fechaSiembra, fecha);

    const plantasQuedan = Number(body.plantas_quedan) || 0;
    const esParcial = body.parcial === true && plantasQuedan > 0 && plantasQuedan < plantasEst;
    const destino = modoFinal === 'cajon' ? 'cajon' : modoFinal === 'paquete' ? (Number(bandejas_armadas) > 0 ? 'bandeja' : 'paquete') : 'planta';

    if (esParcial) {
      // ── COSECHA PARCIAL: divide el lote. Un hijo cosechado con lo cosechado, el padre queda en la mesada ──
      const tubosPadre = Number(lote.tubos_ocupados_actual) || 0;
      const tubosPadreNuevo = tubosPadre > 0 ? Math.max(0, Math.round(tubosPadre * plantasQuedan / plantasEst)) : 0;
      const tubosHijo = Math.max(0, tubosPadre - tubosPadreNuevo);
      const plantasHijo = Math.max(1, plantasEst - plantasQuedan);
      const descarteHijo = modoFinal === 'planta' ? Math.max(0, plantasHijo - unidades) : 0;

      // Id del hijo (división): N1L-007 → N1L-007B
      const idPadreCompleto = /^N[12][LRA]-/.test(lote.id_lote) ? lote.id_lote : completarIdEnTrasplante(lote.id_lote, codigoCultivo(lote.variedad));
      const idHijo = await generarIdDivision(idPadreCompleto, lotes.map(l => l.id_lote));

      await appendRowObj('Lotes', {
        id_lote: idHijo,
        variedad: lote.variedad,
        fecha_siembra: lote.fecha_siembra,
        plantines_iniciales: plantasHijo,
        fase_actual: lote.fase_actual,
        ubicacion_actual: lote.ubicacion_actual,
        tubos_ocupados_actual: tubosHijo,
        plantas_estimadas_actual: plantasHijo,
        fecha_ult_movimiento: fecha,
        fecha_f1: fechaF1 || lote.fecha_f1 || '',
        fecha_f2: fechaF2 || lote.fecha_f2 || '',
        fecha_cosecha: fecha,
        dias_plantinera: diasPlantinera,
        dias_f1: diasF1 || '',
        dias_f2: diasF2 || '',
        dias_total: diasTotal,
        unidades_cosechadas: unidades,
        plantas_por_unidad_real: es_por_paquete ? (Number(plantas_por_paquete) || 0) : 1,
        descarte_reportado: descarteHijo,
        peso_muestra_kg: pesoMuestra,
        peso_total_estimado_kg: pesoKg > 0 ? pesoKg.toFixed(3) : '',
        cajones_armados: modoFinal === 'cajon' ? (Number(cajones_armados) || 0) : '',
        peso_muestra_paquete_gr: modoFinal === 'paquete' ? (Number(peso_muestra_paquete_gr) || '') : '',
        destino_cosecha: destino,
        estado: 'cosechado',
        lote_origen: id_lote,
        usuario_creador: user.email,
        notas: `Cosecha parcial de ${id_lote}`,
      });

      // El padre queda activo con lo que sobra
      await updateRow('Lotes', 'id_lote', id_lote, {
        plantas_estimadas_actual: plantasQuedan,
        tubos_ocupados_actual: tubosPadreNuevo,
        fecha_ult_movimiento: fecha,
      });

      const idMov = await proximoIdMovimiento();
      await appendRow('Movimientos', [
        idMov, idHijo, fecha, 'cosecha',
        lote.fase_actual, '',
        lote.ubicacion_actual, '',
        tubosHijo || '',
        plantasHijo, unidades,
        es_por_paquete ? (Number(plantas_por_paquete) || 0) : '',
        tubos_consumidos_bandejas || '', bandejas_armadas || '',
        descarteHijo, descarteHijo,
        '', '',
        '', '', '',
        user.email || lote.usuario_creador, '',
        `Cosecha parcial de ${id_lote}: ${unidades} ${es_por_paquete ? 'paquetes' : 'plantas'} (quedan ${plantasQuedan})`,
      ]);

      return NextResponse.json({ ok: true, parcial: true, id_hijo: idHijo, plantas_quedan: plantasQuedan });
    }

    await updateRow('Lotes', 'id_lote', id_lote, {
      fecha_cosecha: fecha,
      unidades_cosechadas: unidades,
      plantas_por_unidad_real: es_por_paquete ? (Number(plantas_por_paquete) || 0) : 1,
      descarte_reportado: descarteEf,
      peso_muestra_kg: pesoMuestra,
      peso_total_estimado_kg: pesoKg > 0 ? pesoKg.toFixed(3) : '',
      cajones_armados: modoFinal === 'cajon' ? (Number(cajones_armados) || 0) : '',
      peso_muestra_paquete_gr: modoFinal === 'paquete' ? (Number(peso_muestra_paquete_gr) || '') : '',
      destino_cosecha: destino,
      estado: 'cosechado',
      fecha_ult_movimiento: fecha,
      // Columnas de análisis
      fecha_f1: fechaF1 || '',
      fecha_f2: fechaF2 || '',
      dias_plantinera: diasPlantinera,
      dias_f1: diasF1 || '',
      dias_f2: diasF2 || '',
      dias_total: diasTotal,
    });

    const idMov = await proximoIdMovimiento();
    await appendRow('Movimientos', [
      idMov, id_lote, fecha, 'cosecha',
      lote.fase_actual, '',
      lote.ubicacion_actual, '',
      lote.tubos_ocupados_actual || '',
      plantasUsadas, unidades,
      es_por_paquete ? (Number(plantas_por_paquete) || 0) : '',
      tubos_consumidos_bandejas || '',
      bandejas_armadas || '',
      descarteEf, descarteEf,
      desvio, nivel,
      '', '', '',
      user.email || lote.usuario_creador, '',
      es_por_paquete
        ? `Cosecha ${unidades} paquetes${Number(bandejas_armadas) > 0 ? ` + ${bandejas_armadas} bandejas` : ''}`
        : `Cosecha ${plantas_cosechadas} plantas`,
    ]);

    return NextResponse.json({ ok: true });

  } catch (err: any) {
    console.error('Error cosechando:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
