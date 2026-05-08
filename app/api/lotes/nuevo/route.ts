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
    if (!nave || !variedad || !plantines_iniciales || !fecha_siembra) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    const idLote = await generarIdSiembra(nave);
    const idMov = await proximoIdMovimiento();
    const ubic = 'Nave ' + nave + ' - Plantinera';
    await appendRow('Lotes', [idLote, variedad, fecha_siembra, plantines_iniciales, 'plantin', ubic, '', plantines_iniciales, fecha_siembra, '', '', '', '', '', '', user.email, '', '', semilla_id || '', '', notas || '', 'activo']);
    await appendRow('Movimientos', [idMov, idLote, fecha_siembra, 'siembra', '', 'plantin', '', ubic, '', plantines_iniciales, '', '', '', '', '', '', '', '', '', '', '', user.email, '', 'Siembra inicial: ' + plantines_iniciales + ' plantines']);
    return NextResponse.json({ ok: true, id_lote: idLote });
  } catch (err: any) { console.error('Error creando lote:', err); return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 }); }
}