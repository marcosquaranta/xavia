import { NextRequest, NextResponse } from 'next/server';
import { crearItemDesdeAviso, htmlATexto } from '@/lib/bandejaMail';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Correo reenviado → bandeja de cobranzas ──────────────────────────────────────────
//
// Acá caen los avisos de pago que Gmail reenvía a la casilla de la app. Resend recibe el
// mail y pega en este endpoint; la app lee el cuerpo, saca importe y facturas, y deja un
// CANDIDATO en la bandeja. Nada se registra en Xubio: eso lo confirma una persona.
//
// Esa separación no es un detalle de diseño, es la seguridad del asunto. Este endpoint es
// público —tiene que serlo para que Resend pueda llamarlo— y recibe texto escrito por
// terceros. Que lo único que pueda hacer sea crear una fila para revisar es lo que hace
// que no importe quién escriba ese texto: no hay nada que un mail pueda ordenarle a la app.
//
// Igual se pide un token secreto en la URL, para que la bandeja no se llene de basura si
// alguien descubre la dirección. Sin COBRANZAS_EMAIL_TOKEN configurado el endpoint queda
// apagado: es preferible no recibir nada a recibir de cualquiera.

async function contenidoDelMail(emailId: string): Promise<{ texto: string; asunto: string; remitente: string } | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !emailId) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('[cobranzas/email] Resend no devolvió el contenido:', res.status);
      return null;
    }
    const j: any = await res.json();
    const texto = String(j?.text || '').trim() || htmlATexto(String(j?.html || ''));
    return {
      texto,
      asunto: String(j?.subject || ''),
      remitente: String(j?.from || ''),
    };
  } catch (e) {
    console.error('[cobranzas/email] excepción pidiendo el contenido:', e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const esperado = process.env.COBRANZAS_EMAIL_TOKEN;
  if (!esperado) return NextResponse.json({ error: 'no_configurado' }, { status: 503 });

  const token = req.nextUrl.searchParams.get('token') || req.headers.get('x-xavia-token') || '';
  if (token !== esperado) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const evento = await req.json().catch(() => ({} as any));
    const tipo = String(evento?.type || '');
    // Resend manda varios tipos de evento al mismo webhook; solo interesa el correo que
    // llega. Se contesta 200 igual para que no lo reintente eternamente.
    if (tipo && tipo !== 'email.received') return NextResponse.json({ ok: true, ignorado: tipo });

    const data = evento?.data || {};
    // El webhook trae SOLO metadatos —así lo diseñó Resend, para no mandar adjuntos
    // gigantes—, el cuerpo se pide aparte. Si por lo que sea ya viniera el texto, se usa.
    const yaTraeTexto = String(data?.text || '').trim() || htmlATexto(String(data?.html || ''));
    const contenido = yaTraeTexto
      ? { texto: yaTraeTexto, asunto: String(data?.subject || ''), remitente: String(data?.from || '') }
      : await contenidoDelMail(String(data?.email_id || ''));

    if (!contenido || !contenido.texto) {
      console.error('[cobranzas/email] sin contenido para', data?.email_id);
      return NextResponse.json({ ok: true, sinContenido: true });
    }

    const r = await crearItemDesdeAviso({
      texto: contenido.texto,
      asunto: contenido.asunto,
      remitente: contenido.remitente,
      origen: 'mail',
      usuario: 'correo reenviado',
    });

    // Siempre 200: si se contesta un error, Resend reintenta y termina duplicando. Lo que
    // no se pudo interpretar queda en el log y, si tenía importe, en la bandeja.
    return NextResponse.json({ ok: true, resultado: r });
  } catch (err: any) {
    console.error('[cobranzas/email] error procesando el correo:', err);
    return NextResponse.json({ ok: true, error: err?.message || 'error' });
  }
}
