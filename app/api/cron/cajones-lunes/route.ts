import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, ConfigItem, CajonMovimiento } from '@/lib/types';
import { saldoPorCliente, alertasCajones } from '@/lib/cajones';
import { destinatariosDe } from '@/lib/avisosConfig';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Los cajones que no volvieron, los lunes ──────────────────────────────────────────
//
// Esta alerta vivía arriba de la pantalla de Ventas, que es donde se carga la venta del
// día. Ahí estorbaba: los cajones no se resuelven cargando una venta —es una gestión
// aparte, con el cliente, de otro día— y el bloque empujaba el formulario abajo del
// pliegue.
//
// Se plegó en la pantalla. Pero plegar algo sin darle otra salida es esconderlo: el día
// que nadie lo abre, deja de existir. Por eso sale por mail los lunes, que es cuando se
// arma la semana y se puede hacer algo al respecto.
//
// Usa la MISMA función que la pantalla de cajones y que el panel. Si acá se contara
// distinto, el mail y la pantalla dirían cosas diferentes sobre el mismo cliente.
const CLAVE_CONFIG = 'email_cajones_lunes';
// Desde cuántos días sin movimiento se reclama. Mismo umbral que la alerta de la pantalla.
const DIAS = 7;
const URL_CAJONES = 'https://xavia-self.vercel.app/cajones';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [movimientos, clientes, config] = await Promise.all([
      readSheet<CajonMovimiento>('CajonesMovimientos').catch(() => [] as CajonMovimiento[]),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]),
    ]);

    const alertas = alertasCajones(saldoPorCliente(movimientos, clientes), DIAS);

    if (new URL(req.url).searchParams.get('ver') === '1') {
      return NextResponse.json({ hoy: fechaArgentinaHoy(), cuantos: alertas.length, alertas });
    }

    // Sin cajones afuera no se manda nada: un mail semanal que dice "no hay nada" se
    // archiva sin abrir, y el lunes que sí trae algo se archiva igual.
    if (!alertas.length) return NextResponse.json({ ok: true, enviado: false, motivo: 'no hay cajones sin volver' });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });

    const destinatarios = destinatariosDe(CLAVE_CONFIG, config);
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} no tiene ningún mail válido` }, { status: 500 });

    const total = alertas.reduce((a, c) => a + (Number(c.saldo) || 0), 0);
    const filas = alertas.map((c) => {
      const viejo = (c.diasSinMovimiento || 0) > 21;
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0"><strong>${c.nombre}</strong></td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:800">${c.saldo} ${c.saldo === 1 ? 'cajón' : 'cajones'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;color:${viejo ? '#b91c1c' : '#6b7280'};font-weight:${viejo ? 800 : 600}">
          ${c.diasSinMovimiento} días sin movimiento
        </td>
      </tr>`;
    }).join('');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:620px">
        <h2 style="margin:0 0 4px">Cajones sin volver — ${alertas.length} ${alertas.length === 1 ? 'cliente' : 'clientes'}</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
          <strong>${total} ${total === 1 ? 'cajón' : 'cajones'}</strong> afuera. Son los clientes con saldo a favor nuestro y
          más de ${DIAS} días sin movimiento: ni devolvieron ni se les volvió a dejar.
        </p>
        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:6px 10px;text-align:left">Cliente</th>
            <th style="padding:6px 10px;text-align:right">Debe</th>
            <th style="padding:6px 10px;text-align:right">Hace</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
        <p style="margin:14px 0 0;font-size:11.5px;color:#9ca3af">
          En rojo, los que pasaron los 21 días. El saldo sale de los movimientos cargados: si se devolvieron y no se
          registró, el número está mal acá y en la pantalla igual.
        </p>
        <p style="margin:18px 0 0">
          <a href="${URL_CAJONES}" style="background:#9a3412;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Abrir Cajones
          </a>
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: `Cajones sin volver — ${total} ${total === 1 ? 'cajón' : 'cajones'} en ${alertas.length} cliente(s)`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, enviado: true, clientes: alertas.length, cajones: total, destinatarios });
  } catch (err: any) {
    console.error('[cron/cajones-lunes] error:', err);
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
