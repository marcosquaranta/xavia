import { NextRequest, NextResponse } from 'next/server';
import { crearItemDesdeAviso, htmlATexto } from '@/lib/bandejaMail';
import type { AdjuntoIA } from '@/lib/extraerAvisoIA';

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

// Los PDF adjuntos. En las órdenes de pago de los supermercados el importe y las facturas
// viven ahí adentro y no en el cuerpo del mail, así que sin esto el aviso llega vacío.
//
// Resend no manda el contenido en el webhook —solo metadatos, para no arrastrar archivos
// grandes— sino un `download_url` que dura una hora. Se bajan acá, en el momento.
//
// PDF e IMÁGENES: el modelo lee las dos cosas. Antes solo se bajaban PDF, y como la mitad
// de los avisos llegan como foto o captura del comprobante, esos entraban vacíos —sin
// importe y sin facturas— y había que cargarlos a mano. Una planilla adjunta se sigue
// ignorando.
const MAX_PDF_MB = 25;
const TIPOS_OK = ['pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function tipoDeAdjunto(a: any): string {
  const declarado = String(a?.content_type || '').toLowerCase();
  if (declarado) return declarado;
  // Algunos clientes de correo no declaran el tipo: se deduce de la extensión, que es mejor
  // que descartar un comprobante por un dato que el remitente no mandó.
  const nombre = String(a?.filename || '').toLowerCase();
  if (nombre.endsWith('.pdf')) return 'application/pdf';
  if (nombre.endsWith('.png')) return 'image/png';
  if (nombre.endsWith('.gif')) return 'image/gif';
  if (nombre.endsWith('.webp')) return 'image/webp';
  if (nombre.endsWith('.jpg') || nombre.endsWith('.jpeg')) return 'image/jpeg';
  return '';
}

async function pdfsDelMail(emailId: string): Promise<AdjuntoIA[]> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !emailId) return [];
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('[cobranzas/email] no se pudieron listar los adjuntos:', res.status);
      return [];
    }
    const j: any = await res.json();
    const lista: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    const out: AdjuntoIA[] = [];
    for (const a of lista.slice(0, 5)) {
      const tipo = tipoDeAdjunto(a);
      const nombre = String(a?.filename || 'adjunto');
      if (!TIPOS_OK.some((t) => tipo.includes(t))) continue;
      const url = String(a?.download_url || '');
      if (!url) continue;
      try {
        const bin = await fetch(url, { cache: 'no-store' });
        if (!bin.ok) continue;
        const buf = Buffer.from(await bin.arrayBuffer());
        if (buf.length > MAX_PDF_MB * 1024 * 1024) {
          console.error('[cobranzas/email] adjunto demasiado grande:', nombre, buf.length);
          continue;
        }
        out.push({ nombre, base64: buf.toString('base64'), tipo });
      } catch (e) {
        console.error('[cobranzas/email] no se pudo bajar el adjunto', nombre, e);
      }
    }
    return out;
  } catch (e) {
    console.error('[cobranzas/email] excepción con los adjuntos:', e);
    return [];
  }
}

// Acuse de recibo. Sin esto, mandar un aviso a la casilla es tirar algo a un pozo: no hay
// forma de saber si llegó, si se entendió o si se perdió en el camino. El acuse va a
// administración y NO al remitente original — el que manda el aviso es el cliente, y no
// tiene por qué recibir nada de esto.
//
// Se manda SIEMPRE, también cuando no se pudo interpretar: ese es justamente el momento en
// que hace falta enterarse.
const ACUSE_A = ['administracion@xavia.com.ar'];
const URL_BANDEJA = 'https://xavia-self.vercel.app/cobranzas';

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

async function acusarRecibo(args: {
  asunto: string; remitente: string; resultado: any; texto: string;
}): Promise<{ ok: boolean; detalle: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, detalle: 'RESEND_API_KEY no configurada' };
  const r = args.resultado || {};

  let titulo = '', color = '#166534', detalle = '';
  if (r.motivo === 'confirmacion') {
    titulo = 'Llegó la confirmación de reenvío de Gmail';
    color = '#b45309';
    detalle = `<p style="font-size:14px">Código: <strong style="font-size:18px">${r.codigo || '(no se encontró en el mensaje)'}</strong></p>
      <p style="font-size:13px;color:#555">Pegalo en Gmail → Configuración → Reenvío y correo POP/IMAP. No uses el link del mail: falla cuando hay varias cuentas de Google abiertas.</p>`;
  } else if (r.ok) {
    titulo = 'Aviso de pago procesado';
    detalle = `${r.leidoCon === 'ia'
      ? `<p style="font-size:12.5px;color:#5b21b6;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:7px 10px">
           Este lo leyó la IA (el texto solo no alcanzaba, o el dato estaba en un PDF). Confianza: <strong>${r.confianza}</strong>.
           ${r.comentarioIA ? `<br>${r.comentarioIA}` : ''}
           ${r.confianza !== 'alta' ? '<br><strong>Revisá el importe antes de confirmar.</strong>' : ''}
         </p>`
      : ''}
    <ul style="font-size:14px;color:#111">
      <li>Importe: <strong>${fmt$(Number(r.importe) || 0)}</strong></li>
      <li>Cliente: ${r.cliente ? `<strong>${r.cliente}</strong>` : '<span style="color:#b45309">no lo reconocí — lo elegís al confirmar</span>'}</li>
      <li>Facturas: ${r.comprobantes?.length ? `<code>${r.comprobantes.join(', ')}</code>` : '<span style="color:#9ca3af">ninguna mencionada</span>'}</li>
    </ul>
    <p style="font-size:13px;color:#555">Está en la bandeja esperando que lo confirmes. Todavía no se registró nada en Xubio.</p>`;
  } else if (r.motivo === 'duplicado') {
    titulo = 'Ese aviso ya estaba cargado';
    color = '#6b7280';
    detalle = `<p style="font-size:13px;color:#555">Se ignoró para no imputar el mismo cobro dos veces. Si creés que es un pago distinto con el mismo importe y fecha, cargalo a mano desde la bandeja.</p>`;
  } else {
    titulo = 'Llegó un mail pero no pude interpretarlo';
    color = '#b91c1c';
    detalle = `<p style="font-size:13px;color:#555">No encontré un importe, ni en el texto ni en los adjuntos.${
      r.comentarioIA ? ` La IA dice: <em>${r.comentarioIA}</em>` : ''
    } Puede ser que el dato esté en una imagen escaneada. Abrí la bandeja y usá <strong>Pegar aviso de pago</strong> con el texto, o cargá el cobro a mano.</p>`;
  }

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
      <h2 style="margin:0 0 4px;color:${color}">${titulo}</h2>
      <p style="margin:0 0 12px;color:#6b7280;font-size:13px">
        De: ${args.remitente || '(sin remitente)'}<br>Asunto: ${args.asunto || '(sin asunto)'}
      </p>
      ${detalle}
      <p style="margin:16px 0 0">
        <a href="${URL_BANDEJA}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
          Abrir la bandeja
        </a>
      </p>
      <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;white-space:pre-wrap">${args.texto.replace(/\s+/g, ' ').slice(0, 300)}…</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: ACUSE_A,
        subject: `${titulo} — ${args.asunto || 'aviso de pago'}`,
        html,
      }),
    });
    // Mirar la respuesta, no solo mandar. Un acuse que Resend rechaza y nadie chequea es
    // peor que no tener acuse: se confía en un aviso que nunca llega.
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[cobranzas/email] Resend rechazó el acuse:', res.status, err);
      return { ok: false, detalle: `Resend ${res.status}: ${err.slice(0, 200)}` };
    }
    return { ok: true, detalle: 'enviado' };
  } catch (e: any) {
    console.error('[cobranzas/email] no se pudo mandar el acuse:', e);
    return { ok: false, detalle: e?.message || 'excepción al enviar' };
  }
}

// El único buzón que se procesa. Marcos reenvía a mano lo que el filtro de Gmail no
// agarra, así que cualquier otra cosa que llegue al dominio —una respuesta de un cliente,
// una notificación de Resend, un mail mandado por error— no es un aviso de pago y no tiene
// que terminar en la bandeja de cobranzas.
//
// Se puede cambiar por variable de entorno sin tocar código, porque la dirección la asigna
// Resend y puede cambiar el día que se mueva el dominio.
const BUZON_COBROS = (process.env.COBRANZAS_BUZON || 'cobros@xeniikkro.resend.app').toLowerCase().trim();

// A quién venía dirigido el correo. Resend manda estos campos a veces como texto y a veces
// como lista, y el texto puede venir con nombre ("Cobros <cobros@...>"), así que se aplana
// todo a minúsculas y se busca la dirección adentro.
function destinatarios(data: any): string {
  const campos = [data?.to, data?.cc, data?.bcc, data?.headers?.to];
  const partes: string[] = [];
  for (const c of campos) {
    if (!c) continue;
    if (Array.isArray(c)) partes.push(...c.map((x: any) => typeof x === 'string' ? x : String(x?.address || x?.email || '')));
    else partes.push(String(c));
  }
  return partes.join(' ').toLowerCase();
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

    // Si se pudo leer a quién iba dirigido y no era el buzón de cobros, se descarta sin
    // procesarlo. Cuando NO se puede leer el destinatario se procesa igual: quedarse con
    // la duda y tirar el correo sería peor —un aviso de pago perdido en silencio— que
    // dejar pasar alguno de más, que a lo sumo aparece como una fila para descartar.
    const paraQuien = destinatarios(data);
    if (paraQuien && !paraQuien.includes(BUZON_COBROS)) {
      console.log('[cobranzas/email] ignorado, no iba a', BUZON_COBROS, '→', paraQuien.slice(0, 200));
      return NextResponse.json({ ok: true, ignorado: 'otro_destinatario' });
    }
    // El webhook trae SOLO metadatos —así lo diseñó Resend, para no mandar adjuntos
    // gigantes—, el cuerpo se pide aparte. Si por lo que sea ya viniera el texto, se usa.
    const yaTraeTexto = String(data?.text || '').trim() || htmlATexto(String(data?.html || ''));
    const contenido = yaTraeTexto
      ? { texto: yaTraeTexto, asunto: String(data?.subject || ''), remitente: String(data?.from || '') }
      : await contenidoDelMail(String(data?.email_id || ''));

    if (!contenido || !contenido.texto) {
      console.error('[cobranzas/email] sin contenido para', data?.email_id);
      const acuseSin = await acusarRecibo({
        asunto: String(data?.subject || ''), remitente: String(data?.from || ''),
        resultado: { ok: false }, texto: '(no se pudo leer el cuerpo del mensaje)',
      });
      return NextResponse.json({ ok: true, sinContenido: true, acuse: acuseSin });
    }

    // Los adjuntos se piden SIEMPRE, no solo cuando el webhook los anuncia.
    //
    // El webhook de Resend trae metadatos, y el campo `attachments` puede no venir aunque el
    // correo tenga adjuntos. Con la condición anterior —bajar solo si `data.attachments`
    // tenía algo— las órdenes de pago en PDF no se leían nunca: el aviso entraba con lo poco
    // que dijera el cuerpo del mail y el PDF, que es donde está la información de verdad,
    // no se miraba. Y no había forma de notarlo desde afuera, porque el aviso igual entraba.
    //
    // Cuesta una llamada más a la API de Resend por correo. Es barato al lado de lo que
    // arregla, y si el correo no tiene adjuntos la lista vuelve vacía y no se baja nada.
    const pdfs = await pdfsDelMail(String(data?.email_id || ''));
    if (pdfs.length) console.log(`[cobranzas/email] ${pdfs.length} PDF(s) para leer:`, pdfs.map(p => p.nombre).join(', '));

    const r = await crearItemDesdeAviso({
      texto: contenido.texto,
      asunto: contenido.asunto,
      remitente: contenido.remitente,
      origen: 'mail',
      usuario: 'correo reenviado',
      pdfs,
    });

    const acuse = await acusarRecibo({
      asunto: contenido.asunto, remitente: contenido.remitente,
      resultado: r, texto: contenido.texto,
    });

    // Siempre 200: si se contesta un error, Resend reintenta y termina duplicando. Lo que
    // no se pudo interpretar queda avisado por el acuse y, si tenía importe, en la bandeja.
    return NextResponse.json({ ok: true, resultado: r, acuse });
  } catch (err: any) {
    console.error('[cobranzas/email] error procesando el correo:', err);
    return NextResponse.json({ ok: true, error: err?.message || 'error' });
  }
}
