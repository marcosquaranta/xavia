import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRowObj, readSheet, updateRow } from '@/lib/sheets';
import type { Articulo } from '@/lib/types';

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const { categoria, articulo, unidad_medida, formula_uso, factor_uso } = body;
    if (!categoria || !articulo || !unidad_medida) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    const articulos = await readSheet<Articulo>('Articulos');
    const maxId = articulos
      .map((a) => parseInt(String(a.id_articulo).replace('ART-', '') || '0'))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);
    const idNuevo = `ART-${String(maxId + 1).padStart(4, '0')}`;

    await appendRowObj('Articulos', {
      id_articulo: idNuevo, categoria, articulo, unidad_medida, activo: 'SI',
      formula_uso: formula_uso || '', factor_uso: factor_uso || '',
    });

    return NextResponse.json({ ok: true, id_articulo: idNuevo });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_articulo, ...fields } = await req.json();
    if (!id_articulo) return NextResponse.json({ error: 'id_articulo requerido' }, { status: 400 });
    const updated = await updateRow('Articulos', 'id_articulo', String(id_articulo), fields);
    if (!updated) return NextResponse.json({ error: 'articulo_no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
