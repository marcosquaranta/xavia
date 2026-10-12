import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { preguntarAlAsistente, type MensajeChat } from '@/lib/asistente';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// El asistente del panel. El rol sale de la sesión, NUNCA del pedido: si viniera en el body,
// cualquiera podría pedir los números de administración mandando rol: 'admin'.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const body = await req.json();
    const mensajes: MensajeChat[] = (Array.isArray(body?.mensajes) ? body.mensajes : [])
      .filter((m: any) => m && (m.rol === 'user' || m.rol === 'assistant') && typeof m.texto === 'string')
      // Solo las últimas vueltas: la conversación entera crecería sin techo y cada pregunta
      // costaría más que la anterior sin contestar mejor.
      .slice(-12)
      .map((m: any) => ({ rol: m.rol, texto: String(m.texto).slice(0, 4000) }));

    if (!mensajes.length || mensajes[mensajes.length - 1].rol !== 'user') {
      return NextResponse.json({ error: 'Falta la pregunta.' }, { status: 400 });
    }

    const r = await preguntarAlAsistente({ mensajes, rol: user.rol, nombre: user.nombre });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 500 });
    return NextResponse.json({ ok: true, texto: r.texto, herramientas: r.herramientasUsadas });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
