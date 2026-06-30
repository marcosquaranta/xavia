import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow, appendRowObj } from '@/lib/sheets';
import { parseReparto, REPARTO_DEFAULT } from '@/lib/planificacion';

const CLAVE = 'plan_reparto';

export async function GET() {
  try {
    const items = await readSheet<{ clave: string; valor: any }>('Configuracion');
    const item = items.find(i => i.clave === CLAVE);
    return NextResponse.json({ reparto: item ? parseReparto(item.valor) : REPARTO_DEFAULT });
  } catch {
    return NextResponse.json({ reparto: REPARTO_DEFAULT });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const reparto = parseReparto(body.reparto);
    const valor = JSON.stringify(reparto);
    const items = await readSheet<{ clave: string; valor: any }>('Configuracion');
    if (items.find(i => i.clave === CLAVE)) {
      await updateRow('Configuracion', 'clave', CLAVE, { valor });
    } else {
      await appendRowObj('Configuracion', { clave: CLAVE, valor });
    }
    return NextResponse.json({ ok: true, reparto });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 });
  }
}
