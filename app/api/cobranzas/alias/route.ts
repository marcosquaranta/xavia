import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import { HOJA_ALIAS, type AliasCobranza } from '@/lib/bandejaCobranzas';

export const dynamic = 'force-dynamic';

// Borrar un alias aprendido mal.
//
// Hace falta una forma de deshacerlo porque un alias equivocado no falla de manera
// ruidosa: acierta siempre, con la respuesta errónea. Si la app aprendió que cierto texto
// es el cliente X, cada movimiento que lo contenga se va a proponer como X, y quien
// confirma lo va a ver ya reconocido en verde.
//
// No se borra la fila: se le vacía el alias. Así queda el rastro de que existió y de
// quién lo aprendió, y deja de matchear —el matcheo descarta los alias cortos.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador.' }, { status: 403 });
  try {
    const { alias } = await req.json();
    const buscado = String(alias || '').trim();
    if (!buscado) return NextResponse.json({ error: 'Falta el alias.' }, { status: 400 });

    const filas = await readSheet<AliasCobranza>(HOJA_ALIAS).catch(() => [] as AliasCobranza[]);
    if (!filas.some(f => String(f.alias).trim() === buscado)) {
      return NextResponse.json({ error: 'No se encontró ese alias.' }, { status: 404 });
    }

    const ok = await updateRow(HOJA_ALIAS, 'alias', buscado, {
      alias: '',
      cliente: `(borrado) ${filas.find(f => String(f.alias).trim() === buscado)?.cliente || ''}`,
    });
    if (!ok) return NextResponse.json({ error: 'No se pudo borrar.' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
