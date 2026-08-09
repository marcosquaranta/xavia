import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRowObj, readSheet, updateRow } from '@/lib/sheets';

const CLAVE = 'cajones_unidades_por_cajon';

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });
  try {
    const { unidades_por_cajon } = await req.json();
    const valor = Number(unidades_por_cajon);
    if (!(valor > 0)) return NextResponse.json({ error: 'valor_invalido' }, { status: 400 });
    const items = await readSheet<{ clave: string; valor: any }>('Configuracion');
    if (items.find(i => i.clave === CLAVE)) {
      await updateRow('Configuracion', 'clave', CLAVE, { valor });
    } else {
      await appendRowObj('Configuracion', { clave: CLAVE, valor });
    }
    return NextResponse.json({ ok: true, unidades_por_cajon: valor });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
