// app/api/lotes/nuevo/route.ts
// Crea un nuevo lote con id provisional N1-XXX o N2-XXX.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow } from '@/lib/sheets';
import { generarIdSiembra } from '@/lib/loteId';
import { proximoIdMovimiento } from '@/lib/lotes';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      nave,
      variedad,
      semilla_id,
      plantines_iniciales,
      fecha_siembra,
      notas,
    } = body;

    if (!nave || !variedad || !plantines_iniciales || !fecha_siembra) {
      return NextResponse.json(
        { error: 'datos_incompletos' },
        { status: 400 }
      );
    }

    const idLote = await generarIdSiembra(nave);
    const idMov = await proximoIdMovimiento();
    const ubicacionPlantinera = `Nave ${nave} - Plantinera`;

    // Agrega fila a Lotes
    // Orden de columnas:
    // id_lote, variedad, fecha_siembra, plantines_iniciales, fase_actual,
    // ubicacion_actual, tubos_ocupados_actual, plantas_estimadas_actual,
    // fecha_ult_movimiento, fecha_cosecha, unidades_cosechadas,
    // plantas_por_unidad_real, descarte_reportado, peso_muestra_kg,
    // peso_total_estimado_kg, usuario_creador, foto_url,
    // lote_origen, semilla_id, destino_cosecha, notas, estado
    await appendRow('Lotes', [
      idLote,
      variedad,
      fecha_siembra,
      plantines_iniciales,
      'plantin',
      ubicacionPlantinera,
      '',
      plantines_iniciales,
      fecha_siembra,
      '',
      '',
      '',
      '',
      '',
      '',
      user.email,
      '',
      '',
      semilla_id || '',
      '',
      notas || '',
      'activo',
    ]);

    // Agrega movimiento de siembra
    await appendRow('Movimientos', [
      idMov,
      idLote,
      fecha_siembra,
      'siembra',
      '',
      'plantin',
      '',
      ubicacionPlantinera,
      '',
      plantines_iniciales,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      user.email,
      '',
      `Siembra inicial: ${plantines_iniciales} plantines`,
    ]);

    return NextResponse.json({ ok: true, id_lote: idLote });
  } catch (err: any) {
    console.error('Error creando lote:', err);
    return NextResponse.json(
      { error: err.message || 'server_error' },
      { status: 500 }
    );
  }
}
