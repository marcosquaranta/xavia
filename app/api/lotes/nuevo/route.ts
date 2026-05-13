import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow } from '@/lib/sheets';
import { generarIdSiembra } from '@/lib/loteId';
import { proximoIdMovimiento } from '@/lib/lotes';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { nave, variedad, semilla_id, plantines_iniciales, fecha_siembra, notas } = await req.json();
    if (!nave || !variedad || !plantines_iniciales || !fecha_siembra) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    const idLote = await generarIdSiembra(nave);
    const idMov = await proximoIdMovimiento();
    const ubic = `Nave ${nave} - Plantinera`;

    // En plantinera siempre se guarda en plantines, sin conversión.
    // El factor ×2 de rúcula entra recién en el trasplante.
    await appendRow('Lotes', [
      idLote,              // id_lote
      variedad,            // variedad
      fecha_siembra,       // fecha_siembra
      plantines_iniciales, // plantines_iniciales
      'plantin',           // fase_actual
      ubic,                // ubicacion_actual
      '',                  // tubos_ocupados_actual
      plantines_iniciales, // plantas_estimadas_actual (= plantines en esta fase)
      fecha_siembra,       // fecha_ult_movimiento
      '',                  // fecha_f1
      '',                  // fecha_f2
      '',                  // fecha_cosecha
      '',                  // dias_plantinera
      '',                  // dias_f1
      '',                  // dias_f2
      '',                  // dias_total
      '',                  // unidades_cosechadas
      '',                  // plantas_por_unidad_real
      '',                  // descarte_reportado
      '',                  // peso_muestra_kg
      '',                  // peso_total_estimado_kg
      user.email,          // usuario_creador
      '',                  // foto_url
      '',                  // lote_origen
      semilla_id || '',    // semilla_id
      '',                  // destino_cosecha
      notas || '',         // notas
      'activo',            // estado
    ]);

    await appendRow('Movimientos', [
      idMov, idLote, fecha_siembra, 'siembra', '', 'plantin',
      '', ubic, '', plantines_iniciales,
      '', '', '', '', '', '', '', '', '', '', '',
      user.email, '', `Siembra inicial: ${plantines_iniciales} plantines`,
    ]);

    return NextResponse.json({ ok: true, id_lote: idLote });
  } catch (err: any) {
    console.error('Error creando lote:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
