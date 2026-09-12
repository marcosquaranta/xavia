import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, readSheet, updateRow, asegurarColumna } from '@/lib/sheets';
import { COL_ACTIVO, COL_EMAIL, CONFIG_DATOS_PAGO } from '@/lib/recordatoriosCobro';

export const dynamic = 'force-dynamic';

// Prender/apagar el recordatorio por cliente y editar los datos bancarios del mail.
// Solo admin: define qué le llega a un cliente externo.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede cambiar esto.' }, { status: 403 });
  try {
    const body = await req.json();

    if (body.datosPago !== undefined) {
      const valor = String(body.datosPago || '').trim();
      const filas = await readSheet<{ clave: string; valor: any }>('Configuracion');
      const existe = filas.some((f) => String(f.clave).trim() === CONFIG_DATOS_PAGO);
      if (existe) await updateRow('Configuracion', 'clave', CONFIG_DATOS_PAGO, { valor });
      else await appendRowObj('Configuracion', { clave: CONFIG_DATOS_PAGO, valor, descripcion: 'Datos bancarios que se incluyen en los recordatorios de cobro' });
      return NextResponse.json({ ok: true });
    }

    const idControl = String(body.id_control || '').trim();
    if (!idControl) return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 });
    for (const col of [COL_ACTIVO, COL_EMAIL]) await asegurarColumna('Clientes', col);

    const updates: Record<string, any> = {};
    if (body.activo !== undefined) updates[COL_ACTIVO] = body.activo ? 'SI' : 'NO';
    if (body.email !== undefined) {
      const mail = String(body.email || '').trim();
      // Un recordatorio prendido con un mail mal escrito no falla: se manda a nadie. Mejor
      // frenarlo acá que descubrirlo cuando el cliente nunca contesta.
      if (mail && !mail.includes('@')) return NextResponse.json({ error: `"${mail}" no parece un mail.` }, { status: 400 });
      updates[COL_EMAIL] = mail;
    }
    if (!Object.keys(updates).length) return NextResponse.json({ error: 'No hay nada para cambiar.' }, { status: 400 });

    const okUp = await updateRow('Clientes', 'id_control', idControl, updates);
    if (!okUp) return NextResponse.json({ error: 'No se encontró el cliente.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
