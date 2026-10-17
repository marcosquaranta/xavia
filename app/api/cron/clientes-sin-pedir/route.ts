import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia, ClienteVenta, ConfigItem } from '@/lib/types';
import { clientesSinPedir, DIAS_AVISO, DIAS_DESCARTE } from '@/lib/clientesSinPedir';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// A quién le llega. Es una lista de la planilla (Configuracion → `email_clientes_sin_pedir`,
// separados por coma) y no una constante en el código: el día que cambie quién sigue a los
// clientes no debería hacer falta un deploy. Sin la clave cargada cae a administración, que
// es mejor que no mandar nada y que nadie se entere de que el aviso existe.
const DESTINO_POR_DEFECTO = ['administracion@xavia.com.ar'];
const CLAVE_CONFIG = 'email_clientes_sin_pedir';
const URL_VENTAS = 'https://xavia-self.vercel.app/ventas';

function hoyArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : String(f || ''); };
const fmtN = (n: number) => Math.round(n).toLocaleString('es-AR');

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [ventas, clientes, config] = await Promise.all([
      readSheet<VentaDia>('Ventas'),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]),
    ]);

    const hoy = hoyArgentina();
    const lista = clientesSinPedir(ventas, clientes, hoy);

    // Sin nadie en la ventana no se manda nada. Un mail semanal que casi siempre dice "no hay
    // novedades" enseña a archivarlo sin abrirlo, y el día que traiga tres nombres tampoco se
    // va a leer.
    if (!lista.length) return NextResponse.json({ ok: true, enviado: false, motivo: 'ninguno en la ventana', hoy });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });

    const crudo = String(config.find((c) => String(c.clave).trim() === CLAVE_CONFIG)?.valor || '').trim();
    const destinatarios = crudo
      ? crudo.split(/[,;]/).map((x) => x.trim()).filter((x) => x.includes('@'))
      : DESTINO_POR_DEFECTO;
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} no tiene ningún mail válido` }, { status: 500 });

    const filas = lista.map((c) => {
      // Rojo cuando ya pasó la mitad de la ventana: a partir de ahí quedan pocos días para
      // que la llamada sirva antes de que el cliente entre en "perdido" y deje de avisarse.
      const urgente = c.dias >= Math.round((DIAS_AVISO + DIAS_DESCARTE) / 2);
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0"><strong>${c.nombre}</strong></td>
        <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:800;color:${urgente ? '#dc2626' : '#111'}">
          ${c.dias} días
          <br><span style="font-weight:400;font-size:11px;color:#9ca3af">última: ${fmtDia(c.ultimaVenta)}</span>
        </td>
        <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#6b7280">
          ${fmtN(c.unidadesUltimas8Semanas)} u
          <br><span style="font-size:11px;color:#9ca3af">${c.vecesUltimas8Semanas} ${c.vecesUltimas8Semanas === 1 ? 'pedido' : 'pedidos'} en 8 sem.</span>
        </td>
      </tr>`;
    }).join('');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:620px">
        <h2 style="margin:0 0 4px;color:#b45309">${lista.length} ${lista.length === 1 ? 'cliente dejó' : 'clientes dejaron'} de pedir</h2>
        <p style="margin:0 0 14px;color:#6b7280;font-size:13px">
          Hace más de ${DIAS_AVISO} días que no cargan un pedido. Ordenados por cuánto compraban:
          el de arriba es al que más conviene llamar primero.
        </p>
        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:6px 10px;text-align:left">Cliente</th>
            <th style="padding:6px 10px;text-align:right">Sin pedir</th>
            <th style="padding:6px 10px;text-align:right">Compraba</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
        <p style="margin:12px 0 0;font-size:11.5px;color:#9ca3af">
          No entran los que hace más de ${DIAS_DESCARTE} días que no piden: a esa altura ya no es un cliente que
          dejó de pedir esta semana, y tenerlos acá todas las semanas haría que este mail se deje de leer.
          Tampoco los que nunca cargaron un pedido.
        </p>
        <p style="margin:16px 0 0">
          <a href="${URL_VENTAS}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Abrir Ventas
          </a>
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: `${lista.length} ${lista.length === 1 ? 'cliente dejó' : 'clientes dejaron'} de pedir — ${lista.slice(0, 3).map((c) => c.nombre).join(', ')}${lista.length > 3 ? '…' : ''}`,
        html,
      }),
    });
    // Mirar la respuesta y no solo mandar: un mail que Resend rechaza y nadie chequea es peor
    // que no tener aviso, porque se confía en algo que nunca llega.
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, enviado: true, cuantos: lista.length, destinatarios, hoy });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
