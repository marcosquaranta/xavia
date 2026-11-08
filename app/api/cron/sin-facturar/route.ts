import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia, ClienteVenta, ConfigItem } from '@/lib/types';
import { ventasSinFacturar, paraElMail, DIAS_SIN_FACTURAR, DIAS_MAX_AVISO_MAIL } from '@/lib/alertasVentas';
import { leerArticulosExtra } from '@/lib/articulosVenta';
import { destinatariosDe } from '@/lib/avisosConfig';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Aviso de ventas cargadas que nunca se facturaron ─────────────────────────────────
//
// El agujero que tapa: una venta se carga en Ventas y después hay que mandarla a Xubio. Si
// ese segundo paso no se hace, no pasa nada visible — la venta figura cargada, el cliente
// recibió la mercadería y no hay ninguna factura. Se descubría meses después, mirando el
// historial, o no se descubría.
//
// Corre todos los días a la mañana, pero solo manda mail si hay algo con más de
// DIAS_SIN_FACTURAR días: avisar de la venta de ayer sería avisar de todo, todos los días,
// y un mail que siempre llega se archiva sin abrir.
const CLAVE_CONFIG = 'email_ventas_sin_facturar';
const URL_HISTORIAL = 'https://xavia-self.vercel.app/ventas/historial';

function hoyArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : String(f || ''); };

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [ventas, clientes, config, extras] = await Promise.all([
      readSheet<VentaDia>('Ventas'),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]),
      leerArticulosExtra().catch(() => []),
    ]);

    const hoy = hoyArgentina();
    // La misma función que alimenta la sección de alertas de Ventas. Si acá se contara
    // distinto, el mail y la pantalla dirían números diferentes sobre lo mismo.
    const todas = ventasSinFacturar(ventas, clientes, hoy, extras.map((a) => a.key));
    // ── Solo las que todavía se pueden arreglar ─────────────────────────────────────
    //
    // Una venta sin facturar se corrige al día siguiente o ya no se corrige. Pasados unos
    // días el aviso deja de ser una tarea, y un mail que repite todos los días las mismas
    // seis ventas viejas deja de abrirse — con lo cual la de ayer, que SÍ se puede
    // arreglar, tampoco se ve.
    //
    // Las viejas no desaparecen: siguen en Ventas y en el historial, que es donde se las
    // mira cuando uno decide ponerse con eso.
    const lista = paraElMail(todas) as typeof todas;
    const viejas = todas.length - lista.length;

    if (!lista.length) {
      return NextResponse.json({ ok: true, enviado: false, hoy,
        motivo: viejas ? `nada reciente sin facturar (${viejas} vieja(s) quedan en la pantalla)` : 'nada sin facturar' });
    }
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });

    const destinatarios = destinatariosDe(CLAVE_CONFIG, config);
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} no tiene ningún mail válido` }, { status: 500 });

    // Los que ese día no tuvieron ninguna factura son los que de verdad faltan facturar. Los
    // otros casi siempre son una carga repetida, y van aparte para que no inflen el número
    // que decide si esto es urgente o no.
    const faltan = lista.filter((p) => !p.huboFacturaEseDia);
    const repetidas = lista.filter((p) => p.huboFacturaEseDia);

    const filasDe = (arr: typeof lista, color: string) => arr.map((p) => `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0"><strong>${p.cliente}</strong></td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:#6b7280">${fmtDia(p.fecha)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:800;color:${color}">${p.dias} días</td>
    </tr>`).join('');

    const bloque = (titulo: string, sub: string, arr: typeof lista, color: string) => arr.length === 0 ? '' : `
      <h3 style="margin:18px 0 2px;font-size:14px;color:${color}">${titulo}</h3>
      <p style="margin:0 0 8px;color:#6b7280;font-size:12.5px">${sub}</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:6px 10px;text-align:left">Cliente</th>
          <th style="padding:6px 10px;text-align:left">Fecha de la venta</th>
          <th style="padding:6px 10px;text-align:right">Hace</th>
        </tr></thead>
        <tbody>${filasDe(arr, color)}</tbody>
      </table>`;

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:640px">
        <h2 style="margin:0 0 4px;color:${faltan.length ? '#b45309' : '#6b7280'}">
          ${lista.length} ${lista.length === 1 ? 'venta cargada' : 'ventas cargadas'} sin facturar
        </h2>
        <p style="margin:0 0 14px;color:#6b7280;font-size:13px">
          Están cargadas en Ventas y nunca se mandaron a Xubio. No hay factura, así que no hay nada para cobrar.
        </p>
        ${bloque(
          `${faltan.length} ${faltan.length === 1 ? 'falta facturar' : 'faltan facturar'}`,
          'Ese día no salió ninguna factura a ese cliente. Son las que hay que facturar.',
          faltan, '#b45309',
        )}
        ${bloque(
          `${repetidas.length} ${repetidas.length === 1 ? 'probable carga repetida' : 'probables cargas repetidas'}`,
          'Ese mismo día SÍ se le facturó al cliente, así que lo más probable es que esta carga esté duplicada y haya que borrarla — no facturarla de nuevo.',
          repetidas, '#1d4ed8',
        )}
        <p style="margin:14px 0 0;font-size:11.5px;color:#9ca3af">
          No entran las de los últimos ${DIAS_SIN_FACTURAR} días —una venta cargada hoy todavía no tiene por qué estar
          facturada— ni las de más de ${DIAS_MAX_AVISO_MAIL}: ésas ya no se arreglan a tiempo y quedan en la pantalla de Ventas.
          ${viejas ? `<strong>Hay ${viejas} más de ${DIAS_MAX_AVISO_MAIL} días</strong> que no entran en este mail.` : ''}
        </p>
        <p style="margin:16px 0 0">
          <a href="${URL_HISTORIAL}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Abrir el historial de facturación
          </a>
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: faltan.length
          ? `${faltan.length} ${faltan.length === 1 ? 'venta sin facturar' : 'ventas sin facturar'} — ${faltan.slice(0, 3).map((p) => p.cliente).join(', ')}${faltan.length > 3 ? '…' : ''}`
          : `${repetidas.length} ${repetidas.length === 1 ? 'carga' : 'cargas'} sin facturar que parecen repetidas`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, enviado: true, cuantos: lista.length, faltan: faltan.length, repetidas: repetidas.length, destinatarios, hoy });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
