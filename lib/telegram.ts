// ── El bot de Telegram ───────────────────────────────────────────────────────────────
//
// Una puerta de entrada más a la app, para las cosas que uno sabe cuando NO está frente a
// la computadora: el gasto que acaba de pagar, la venta que acaba de salir. Escribirlo en
// el momento es la única forma de que no se pierda.
//
// Lo que NO es: un segundo sistema. El bot no calcula ni decide nada propio — lee la frase,
// la convierte en una operación y llama al mismo código que usa la pantalla. Si alguna vez
// el bot y la app dieran números distintos, el bot habría dejado de servir.
//
// SEGURIDAD — esto es lo primero de este archivo, no un detalle:
//
// Un bot de Telegram le contesta a CUALQUIERA que lo encuentre. No hay login, no hay
// contraseña: lo único que identifica a quien escribe es el chat_id. Por eso todo mensaje
// de un chat no autorizado se descarta sin responder y sin registrar nada. No se contesta
// "no estás autorizado" tampoco: eso le confirma a un desconocido que el bot existe y que
// hay algo del otro lado.
//
// Y el texto que llega es DATO, nunca instrucciones. Alguien autorizado no va a atacarse a
// sí mismo, pero un mensaje reenviado sí puede traer texto ajeno adentro.

const API = 'https://api.telegram.org/bot';

// Los chat_id que pueden operar, separados por coma en la variable de entorno. Son números
// de Telegram, no datos personales, pero igual viven en el entorno y no en el repo: la
// lista de quién puede cargar gastos no es información pública.
export function chatsAutorizados(): Set<string> {
  return new Set(
    String(process.env.TELEGRAM_CHATS || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  );
}

export function estaAutorizado(chatId: string | number): boolean {
  const permitidos = chatsAutorizados();
  // Sin lista configurada no opera NADIE. Lo contrario —"si no hay lista, que pase todo"—
  // es la clase de valor por defecto que convierte un olvido de configuración en una
  // puerta abierta.
  if (!permitidos.size) return false;
  return permitidos.has(String(chatId));
}

export async function responder(chatId: string | number, texto: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const res = await fetch(`${API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text: texto, parse_mode: 'Markdown',
      // Los links de la app no necesitan vista previa y ensucian el chat.
      disable_web_page_preview: true,
    }),
  });
  return res.ok;
}
