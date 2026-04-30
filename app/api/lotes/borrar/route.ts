// app/api/lotes/borrar/route.ts
// Borra un lote y todos sus movimientos. Solo admin.

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { deleteRow, readSheet } from '@/lib/sheets';
import type { Movimiento } from '@/lib/types';

export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) {
    const url = new URL('/cultivos', req.url);
    return NextResponse.redirect(url, { status: 303 });
  }

  try {
    const formData = await req.formData();
    const idLote = String(formData.get('id_lote') || '');
    if (!idLote) {
      return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    }

    // Borrar todos los movimientos del lote primero
    const movimientos = await readSheet<Movimiento>('Movimientos');
    const movsDelLote = movimientos.filter((m) => m.id_lote === idLote);

    for (const mov of movsDelLote) {
      await deleteRow('Movimientos', 'id_movimiento', String(mov.id_movimiento));
    }

    // Borrar el lote
    await deleteRow('Lotes', 'id_lote', idLote);

    const url = new URL('/cultivos', req.url);
    return NextResponse.redirect(url, { status: 303 });
  } catch (err: any) {
    console.error('Error borrando lote:', err);
    return NextResponse.json(
      { error: err.message || 'server_error' },
      { status: 500 }
    );
  }
}
