import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ACUSE_A = ['administracion@xavia.com.ar'];

// Manda un acuse de prueba y devuelve EXACTAMENTE lo que contestó Resend.
//
// Existe porque "no me llega el mail" tiene media docena de causas que se ven igual desde
// afuera: la API key, el dominio del remitente, la casilla de destino, el spam. Probarlo
// contra un correo real obliga a reenviar un aviso cada vez y a esperar; esto lo resuelve
// en un click y dice cuál de las causas es.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador.' }, { status: 403 });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'No está configurada la clave de envío de correo (RESEND_API_KEY).' }, { status: 500 });
  }

  const ahora = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: ACUSE_A,
        subject: `Prueba de acuse — ${ahora}`,
        html: `<div style="font-family:system-ui,Arial,sans-serif;color:#111">
          <h2 style="margin:0 0 6px">Prueba de acuse</h2>
          <p style="font-size:14px">Si estás leyendo esto, los acuses de los avisos de pago pueden llegar a esta casilla.</p>
          <p style="font-size:13px;color:#6b7280">Enviada desde la bandeja de cobranzas el ${ahora} por ${user.email}.</p>
        </div>`,
      }),
    });

    const cuerpo = await res.text().catch(() => '');
    if (!res.ok) {
      // El texto crudo de Resend, sin interpretar: dice si el problema es el dominio del
      // remitente, la clave o el destinatario, y cada uno se arregla distinto.
      return NextResponse.json({
        error: `Resend rechazó el envío (HTTP ${res.status}): ${cuerpo.slice(0, 300)}`,
      }, { status: 502 });
    }
    return NextResponse.json({ ok: true, destinatarios: ACUSE_A, respuesta: cuerpo.slice(0, 200) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'No se pudo conectar con el servicio de correo.' }, { status: 500 });
  }
}
