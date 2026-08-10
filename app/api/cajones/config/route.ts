import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRowObj, readSheet, updateRow } from '@/lib/sheets';

const CLAVE_RUCULA = 'cajones_unidades_por_cajon_rucula';
const CLAVE_LECHUGA = 'cajones_unidades_por_cajon_lechuga';

async function upsert(items: { clave: string; valor: any }[], clave: string, valor: number) {
  if (items.find((i) => i.clave === clave)) await updateRow('Configuracion', 'clave', clave, { valor });
  else await appendRowObj('Configuracion', { clave, valor });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });
  try {
    const { unidades_por_cajon_rucula, unidades_por_cajon_lechuga } = await req.json();
    const valorRucula = Number(unidades_por_cajon_rucula), valorLechuga = Number(unidades_por_cajon_lechuga);
    if (!(valorRucula > 0) || !(valorLechuga > 0)) return NextResponse.json({ error: 'valor_invalido' }, { status: 400 });
    const items = await readSheet<{ clave: string; valor: any }>('Configuracion');
    await upsert(items, CLAVE_RUCULA, valorRucula);
    await upsert(items, CLAVE_LECHUGA, valorLechuga);
    return NextResponse.json({ ok: true, unidades_por_cajon_rucula: valorRucula, unidades_por_cajon_lechuga: valorLechuga });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
