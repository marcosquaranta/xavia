import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

// `volver` = a dónde redirigir después (ej. la ficha del lote, para revisar con todo el
// contexto a mano) — si no viene, cae al Panel como antes.
function destino(req: NextRequest, formData: FormData): URL {
  const volver = String(formData.get('volver') || '');
  return new URL(volver && volver.startsWith('/') ? volver : '/panel', req.url);
}

export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) return NextResponse.redirect(new URL('/panel', req.url), { status: 303 });
  const user = await getCurrentUser();
  const formData = await req.formData();
  const idMov = String(formData.get('id_movimiento') || '');
  const comentario = String(formData.get('comentario') || '').trim();
  if (!idMov || !comentario) return NextResponse.redirect(destino(req, formData), { status: 303 });
  const fechaHoy = new Date().toISOString().split('T')[0];
  try { await updateRow('Movimientos', 'id_movimiento', idMov, { alerta_revisada: 'SI', alerta_comentario: comentario + ' — ' + (user?.nombre || user?.email) + ' · ' + fechaHoy }); } catch (err) { console.error('Error revisando alerta:', err); }
  return NextResponse.redirect(destino(req, formData), { status: 303 });
}