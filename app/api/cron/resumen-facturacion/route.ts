import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia, ClienteVenta, ConfigItem } from '@/lib/types';
import { armarResumen, diasConAlgo, valeLaPena } from '@/lib/resumenFacturacion';
import { leerArticulosExtra } from '@/lib/articulosVenta';
import { destinatariosDe } from '@/lib/avisosConfig';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Qué se facturó y qué no, día por día ─────────────────────────────────────────────
//
// El aviso de ventas sin facturar miraba una franja de dos días —entre 2 y 3 de
// antigüedad—, así que una venta de ayer era "demasiado nueva" y una de hace nueve días
// "demasiado vieja". Las dos que estaban sin facturar no salían en ningún mail. Un aviso
// con una rendija así no avisa: tranquiliza.
//
// Y le faltaba la otra mitad. Ver solo lo que NO se facturó no deja detectar lo que se
// facturó de más, que es el error caro: la misma venta cargada dos veces sale dos veces y
// el cliente recibe dos facturas. Acá van las dos columnas del mismo día, juntas.
//
// Va a Juan Pablo, que es quien carga las ventas. Es el que puede mirar un pendiente y
// decir si falta facturarlo o si es una carga repetida que hay que borrar — que son dos
// acciones opuestas sobre filas que se ven iguales.
const CLAVE_CONFIG = 'email_resumen_facturacion';
const DIAS_VENTANA = 10;
const URL_FACTURACION = 'https://xavia-self.vercel.app/facturacion';

const fmtDia = (f: string) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : String(f || ''); };

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
      leerArticulosExtra().catch(() => [] as { key: string }[]),
    ]);

    const hoy = fechaArgentinaHoy();
    const r = armarResumen({
      ventas, clientes, hoy,
      dias: DIAS_VENTANA,
      clavesExtra: extras.map((a) => a.key),
    });

    // `ver=1` muestra qué saldría, sin mandar nada.
    if (new URL(req.url).searchParams.get('ver') === '1') {
      return NextResponse.json({ hoy, ...r });
    }

    if (!valeLaPena(r)) {
      return NextResponse.json({ ok: true, enviado: false, hoy, motivo: 'todo facturado y nada sospechoso' });
    }
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });

    const destinatarios = destinatariosDe(CLAVE_CONFIG, config);
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} no tiene ningún mail válido` }, { status: 500 });

    const dias = diasConAlgo(r);
    const { variosComprobantes, pendienteConFactura } = r.sospechas;

    const bloqueDia = (d: typeof dias[number]) => `
      <tr>
        <td style="padding:10px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;white-space:nowrap;width:86px">
          <strong style="font-size:13.5px">${fmtDia(d.fecha)}</strong><br>
          <span style="color:#9ca3af;font-size:11px">${d.dias === 0 ? 'hoy' : d.dias === 1 ? 'ayer' : `hace ${d.dias} días`}</span>
        </td>
        <td style="padding:10px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top">
          ${d.pendientes.length === 0
            ? '<span style="color:#9ca3af;font-size:12.5px">—</span>'
            : d.pendientes.map((p) => `<div style="font-size:12.5px;margin-bottom:3px">
                <strong style="color:#b45309">${p.cliente}</strong>
                ${p.tambienFacturado ? ' <span style="font-size:10.5px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;font-weight:700">ese día ya tiene factura</span>' : ''}
              </div>`).join('')}
        </td>
        <td style="padding:10px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top">
          ${d.facturados.length === 0
            ? '<span style="color:#9ca3af;font-size:12.5px">—</span>'
            : d.facturados.map((f) => `<div style="font-size:12.5px;margin-bottom:3px">
                ${f.cliente}
                <span style="color:#6b7280;font-family:ui-monospace,monospace;font-size:11px">${f.numeros.join(', ')}</span>
                ${f.numeros.length > 1 ? ' <span style="font-size:10.5px;background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:8px;font-weight:700">2 comprobantes</span>' : ''}
              </div>`).join('')}
        </td>
      </tr>`;

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:720px">
        <h2 style="margin:0 0 4px">Facturación de los últimos ${DIAS_VENTANA} días</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
          ${r.totalPendientes > 0
            ? `<strong style="color:#b45309">${r.totalPendientes} ${r.totalPendientes === 1 ? 'venta cargada sigue' : 'ventas cargadas siguen'} sin facturar.</strong> `
            : 'No queda nada sin facturar. '}
          Al lado va lo que sí se facturó cada día, para poder ver si algo salió dos veces.
        </p>

        ${(variosComprobantes.length || pendienteConFactura.length) ? `
        <div style="margin:0 0 18px;padding:11px 13px;background:#fef2f2;border:1px solid #fecaca;border-radius:7px">
          <p style="margin:0 0 5px;font-size:13.5px;font-weight:800;color:#b91c1c">Para mirar — puede haber algo duplicado</p>
          ${variosComprobantes.map((x) => `<p style="margin:0 0 3px;font-size:12.5px;color:#7f1d1d">
            <strong>${x.cliente}</strong> tiene ${x.numeros.length} comprobantes del ${fmtDia(x.fecha)}:
            <span style="font-family:ui-monospace,monospace">${x.numeros.join(', ')}</span>
          </p>`).join('')}
          ${pendienteConFactura.map((x) => `<p style="margin:0 0 3px;font-size:12.5px;color:#7f1d1d">
            <strong>${x.cliente}</strong> tiene una carga sin facturar del ${fmtDia(x.fecha)} y ese mismo día ya se le facturó.
          </p>`).join('')}
          <p style="margin:6px 0 0;font-size:11.5px;color:#991b1b">
            No es un veredicto: puede ser una segunda entrega real. Si no lo es, la carga pendiente se borra en lugar de
            facturarse — facturarla sería emitir la segunda factura con la mano.
          </p>
        </div>` : ''}

        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:6px 10px;text-align:left">Día</th>
            <th style="padding:6px 10px;text-align:left;color:#92400e">Sin facturar</th>
            <th style="padding:6px 10px;text-align:left;color:#166534">Facturado</th>
          </tr></thead>
          <tbody>${dias.map(bloqueDia).join('')}</tbody>
        </table>

        <p style="margin:14px 0 0;font-size:11.5px;color:#9ca3af;line-height:1.5">
          Entra todo lo de los últimos ${DIAS_VENTANA} días, también lo de hoy. Una venta cargada hoy todavía no tiene
          por qué estar facturada: está en la lista para que se vea el día entero, no para reclamarla.
        </p>

        <p style="margin:18px 0 0">
          <a href="${URL_FACTURACION}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Abrir Facturación
          </a>
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: (variosComprobantes.length || pendienteConFactura.length)
          ? `Facturación — ${r.totalPendientes} sin facturar y ${variosComprobantes.length + pendienteConFactura.length} para revisar`
          : `Facturación — ${r.totalPendientes} ${r.totalPendientes === 1 ? 'venta sin facturar' : 'ventas sin facturar'}`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true, enviado: true, hoy,
      pendientes: r.totalPendientes, facturados: r.totalFacturados,
      sospechas: variosComprobantes.length + pendienteConFactura.length,
      destinatarios,
    });
  } catch (err: any) {
    console.error('[cron/resumen-facturacion] error:', err);
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
