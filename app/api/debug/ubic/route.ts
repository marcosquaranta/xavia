import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { naveRealDeLote, mapaMesadaNave } from '@/lib/lotes';
import type { Lote, Ubicacion } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Debug temporal: muestra los valores reales de mesadas y ubicacion_actual de lotes
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  const [lotes, ubic] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Ubicacion>('Ubicaciones'),
  ]);
  const map = mapaMesadaNave(ubic);

  const mesadas = ubic
    .filter(u => u.tipo === 'mesada' && u.activo === 'SI')
    .map(u => `[N${u.nave}] nombre="${u.nombre}"  (id=${u.id_ubicacion})`);

  const activos = lotes
    .filter(l => l.estado === 'activo' && (l.fase_actual === 'fase_1' || l.fase_actual === 'fase_2'))
    .sort((a, b) => String(a.ubicacion_actual || '').localeCompare(String(b.ubicacion_actual || '')))
    .map(l => `id=${l.id_lote}  fase=${l.fase_actual}  tubos=${l.tubos_ocupados_actual}  naveReal=${naveRealDeLote(l, map)}  ubic="${l.ubicacion_actual}"`);

  const txt = [
    '=== MESADAS (activas) ===',
    ...mesadas,
    '',
    '=== LOTES ACTIVOS (F1/F2) ===',
    ...activos,
  ].join('\n');

  return new NextResponse(txt, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
