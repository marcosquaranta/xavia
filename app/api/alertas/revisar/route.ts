import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';
export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) return NextResponse.redirect(new URL('/panel', req.url), { status: 303 });
  const user = await getCurrentUser();
  const formData = await req.formData();
  const idMov = String(formData.get('id_movimiento') || '');
  const comentario = String(formData.get('comentario') || '').trim();
  if (!idMov || !comentario) return NextResponse.redirect(new URL('/alertas', req.url), { status: 303 });
  const fechaHoy = new Date().toISOString().split('T')[0];
  try { await updateRow('Movimientos', 'id_movimiento', idMov, { alerta_revisada: 'SI', alerta_comentario: comentario + ' — ' + (user?.nombre || user?.email) + ' · ' + fechaHoy }); } catch (err) { console.error('Error revisando alerta:', err); }
  return NextResponse.redirect(new URL('/alertas', req.url), { status: 303 });
}