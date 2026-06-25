import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRow, appendRowObj } from '@/lib/sheets';
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
    // Por NOMBRE de columna (inmune al orden de la planilla)
    await appendRowObj('Lotes', {
      id_lote: idLote,
      variedad,
      fecha_siembra,
      plantines_iniciales,
      fase_actual: 'plantin',
      ubicacion_actual: ubic,
      plantas_estimadas_actual: plantines_iniciales,
      fecha_ult_movimiento: fecha_siembra,
      usuario_creador: user.email,
      semilla_id: semilla_id || '',
      notas: notas || '',
      estado: 'activo',
    });

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
