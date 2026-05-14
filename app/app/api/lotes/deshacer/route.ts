import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow, deleteRow } from '@/lib/sheets';
import type { Lote, Movimiento } from '@/lib/types';
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
  try {
    const formData = await req.formData();
    const idLote = String(formData.get('id_lote') || '');
    const idMov = String(formData.get('id_movimiento') || '');
    if (!idLote || !idMov) return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
    const [lotes, movimientos] = await Promise.all([readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos')]);
    const lote = lotes.find((l) => l.id_lote === idLote);
    if (!lote) return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
    const movsLote = movimientos.filter((m) => m.id_lote === idLote).sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
    const ult = movsLote[movsLote.length - 1];
    if (!ult || String(ult.id_movimiento) !== idMov) return NextResponse.redirect(new URL('/cultivos/' + encodeURIComponent(idLote), req.url), { status: 303 });
    const prev = movsLote[movsLote.length - 2];
    const faseAnterior = String(ult.fase_origen || 'plantin');
    const ubicAnterior = String(ult.ubicacion_origen || '');
    const plantasAnterior = Number(prev?.plantas_estimadas) || Number(lote.plantines_iniciales) || 0;
    if (ult.tipo === 'cosecha') {
      await updateRow('Lotes', 'id_lote', idLote, { estado: 'activo', fase_actual: faseAnterior, ubicacion_actual: ubicAnterior, plantas_estimadas_actual: plantasAnterior, fecha_cosecha: '', unidades_cosechadas: '', descarte_reportado: '', peso_muestra_kg: '', peso_total_estimado_kg: '', destino_cosecha: '', fecha_ult_movimiento: prev ? String(prev.fecha) : String(lote.fecha_siembra) });
    } else if (ult.tipo === 'trasplante') {
      await updateRow('Lotes', 'id_lote', idLote, { fase_actual: faseAnterior, ubicacion_actual: ubicAnterior, tubos_ocupados_actual: '', plantas_estimadas_actual: plantasAnterior, plantines_iniciales: plantasAnterior, fecha_ult_movimiento: prev ? String(prev.fecha) : String(lote.fecha_siembra) });
    }
    await deleteRow('Movimientos', 'id_movimiento', idMov);
    return NextResponse.redirect(new URL('/cultivos/' + encodeURIComponent(idLote), req.url), { status: 303 });
  } catch (err: any) { console.error('Error deshaciendo:', err); return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 }); }
}