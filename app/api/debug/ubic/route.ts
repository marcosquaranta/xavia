import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { naveRealDeLote, mapaMesadaNave } from '@/lib/lotes';
import type { Lote, Ubicacion } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Debug temporal. Sin ?q= : lista mesadas y lotes activos F1/F2.
// Con ?q=texto : muestra CUALQUIER lote (cualquier estado/fase) cuyo id o ubicacion contenga el texto.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  const q = (req.nextUrl.searchParams.get('q') || '').toLowerCase();
  const [lotes, ubic] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Ubicacion>('Ubicaciones'),
  ]);
  const map = mapaMesadaNave(ubic);

  let lines: string[];
  if (q) {
    const m = lotes.filter(l =>
      String(l.id_lote || '').toLowerCase().includes(q) ||
      String(l.ubicacion_actual || '').toLowerCase().includes(q)
    );
    lines = [
      `=== LOTES que coinciden con "${q}" (CUALQUIER estado/fase) ===`,
      ...m.map(l => `id=${l.id_lote}  estado=${l.estado}  fase=${l.fase_actual}  tubos=${l.tubos_ocupados_actual}  naveReal=${naveRealDeLote(l, map)}  ubic="${l.ubicacion_actual}"`),
    ];
  } else {
    const mesadas = ubic
      .filter(u => u.tipo === 'mesada' && u.activo === 'SI')
      .map(u => `[N${u.nave}] nombre="${u.nombre}"  (id=${u.id_ubicacion})`);
    const activos = lotes
      .filter(l => l.estado === 'activo' && (l.fase_actual === 'fase_1' || l.fase_actual === 'fase_2'))
      .sort((a, b) => String(a.ubicacion_actual || '').localeCompare(String(b.ubicacion_actual || '')))
      .map(l => `id=${l.id_lote}  fase=${l.fase_actual}  tubos=${l.tubos_ocupados_actual}  naveReal=${naveRealDeLote(l, map)}  ubic="${l.ubicacion_actual}"`);
    lines = ['=== MESADAS (activas) ===', ...mesadas, '', '=== LOTES ACTIVOS (F1/F2) ===', ...activos];
  }

  return new NextResponse(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
