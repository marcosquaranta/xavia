import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { Lote } from '@/lib/types';

export const dynamic = 'force-dynamic';

const FASES_ACTIVAS = ['plantin', 'fase_1', 'fase_2'];

// Encuentra lotes con estado vacío pero claramente activos (tienen fase y ubicación)
// y los marca estado='activo'. Dry-run por defecto; ?apply=1 para aplicar.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  const apply = req.nextUrl.searchParams.get('apply') === '1';
  const lotes = await readSheet<Lote>('Lotes');

  const orfanos = lotes.filter(l =>
    (!l.estado || String(l.estado).trim() === '') &&
    FASES_ACTIVAS.includes(String(l.fase_actual)) &&
    String(l.ubicacion_actual || '').trim() !== ''
  );

  if (apply) {
    for (const l of orfanos) await updateRow('Lotes', 'id_lote', l.id_lote, { estado: 'activo' });
  }

  const lines = orfanos.map(l => `id=${l.id_lote}  fase=${l.fase_actual}  tubos=${l.tubos_ocupados_actual}  ubic="${l.ubicacion_actual}"`);
  const head = apply
    ? `=== CORREGIDOS (estado → activo): ${orfanos.length} ===`
    : `=== A CORREGIR (dry-run · abrí con ?apply=1 para aplicar): ${orfanos.length} ===`;

  return new NextResponse([head, ...lines].join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
