import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { Lote } from '@/lib/types';

export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
  try {
    const formData = await req.formData();
    const idLote = String(formData.get('id_lote') || '');
    if (!idLote) return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
    const lotes = await readSheet<Lote>('Lotes');
    const lote = lotes.find((l) => l.id_lote === idLote);
    if (!lote) return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 });
    // No guardamos el estado previo al borrar (no hay columna para eso) — se infiere:
    // si tiene fecha_cosecha cargada, estaba cosechado; si no, estaba activo. 'descartado'
    // no se usa en ningún flujo real de la app hoy.
    const estadoRestaurado = lote.fecha_cosecha ? 'cosechado' : 'activo';
    await updateRow('Lotes', 'id_lote', idLote, { estado: estadoRestaurado });
    return NextResponse.redirect(new URL('/cultivos?fase=borrados', req.url), { status: 303 });
  } catch (err: any) { console.error('Error restaurando:', err); return NextResponse.redirect(new URL('/cultivos', req.url), { status: 303 }); }
}
