import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { deleteRow, readSheet } from '@/lib/sheets';
import type { Movimiento } from '@/lib/types';
export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
  try {
    const formData = await req.formData();
    const idLote = String(formData.get('id_lote') || '');
    if (!idLote) return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
    const movimientos = await readSheet<Movimiento>('Movimientos');
    for (const m of movimientos.filter((m) => m.id_lote === idLote)) {
      await deleteRow('Movimientos', 'id_movimiento', String(m.id_movimiento));
    }
    await deleteRow('Lotes', 'id_lote', idLote);
    return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
  } catch (err: any) { console.error('Error borrando:', err); return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 }); }
}