import { NextRequest, NextResponse } from 'next/server';
import { estaAutorizado, responder } from '@/lib/telegram';
import { clasificar, ayuda, OPERACIONES } from '@/lib/telegramOps';

export const dynamic = 'force-dynamic';

// Por acá entra todo lo que se le escribe al bot. Telegram llama a esta dirección con cada
// mensaje; no hay sesión de navegador, así que la identidad es el chat_id y nada más.
//
// Siempre devuelve 200, incluso cuando rechaza o falla. Telegram reintenta lo que no
// contesta 200, y un reintento de una operación que ya se cargó la cargaría dos veces: un
// gasto duplicado es peor que un mensaje perdido.
export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    // La ruta es pública —Telegram tiene que poder llamarla— así que el token secreto es
    // lo que distingue a Telegram de cualquiera que encuentre la URL. Sin esto, mandar un
    // `update` armado a mano con un chat_id autorizado alcanzaría para cargar gastos.
    const secreto = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secreto && req.headers.get('x-telegram-bot-api-secret-token') !== secreto) {
      return NextResponse.json({ ok: true });
    }

    const msg = update?.message;
    const chatId = msg?.chat?.id;
    const texto = String(msg?.text || '').trim();
    if (!chatId) return NextResponse.json({ ok: true });

    // Un chat no autorizado no recibe respuesta. Contestarle "no estás autorizado" le
    // confirma a un desconocido que el bot existe y que hay algo del otro lado.
    if (!estaAutorizado(chatId)) return NextResponse.json({ ok: true });

    // El propio chat_id, para poder configurarlo la primera vez sin mirar logs.
    if (texto === '/id') { await responder(chatId, `Tu chat_id es \`${chatId}\``); return NextResponse.json({ ok: true }); }
    if (!texto || texto === '/start' || texto === '/help' || texto === '/ayuda') {
      await responder(chatId, ayuda());
      return NextResponse.json({ ok: true });
    }
    // Un audio es un mensaje que el bot todavía no sabe leer. Decirlo es mejor que el
    // silencio, que se lee como que el bot se colgó.
    if (!texto && (msg?.voice || msg?.audio)) {
      await responder(chatId, 'Todavía no leo audios — escribímelo y lo cargo.');
      return NextResponse.json({ ok: true });
    }

    const clave = await clasificar(texto);
    const op = OPERACIONES.find((o) => o.clave === clave);
    if (!op) { await responder(chatId, `No entendí qué querés cargar.\n\n${ayuda()}`); return NextResponse.json({ ok: true }); }

    try {
      // El usuario que queda en la planilla dice POR DÓNDE entró, no solo quién: un gasto
      // cargado por el bot y uno cargado a mano se ven igual en la fila, y cuando algo sale
      // raro lo primero que se quiere saber es por qué camino entró.
      const respuesta = await op.ejecutar(texto, `telegram:${chatId}`);
      await responder(chatId, respuesta);
    } catch (e: any) {
      // El error llega al que escribió, no a un log que nadie mira. Si no, el mensaje
      // simplemente no pasa nada y se asume que se cargó.
      await responder(chatId, `No pude cargarlo: ${String(e?.message || e).slice(0, 200)}`);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
