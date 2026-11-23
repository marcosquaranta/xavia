import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Gasto, ConfigItem } from '@/lib/types';
import { resumenPagosPendientes, porVencimiento } from '@/lib/pagosPendientes';
import { destinatariosDe } from '@/lib/avisosConfig';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Lo que hay para pagar, todas las mañanas ─────────────────────────────────────────
//
// Reemplaza la solicitud de pago por mail. Antes: Franco compra, manda un mail pidiendo que
// se pague, y ese mail es el único lugar donde existe el dato. Ahora: Franco carga la compra
// con "todavía no lo pagué" y el alias, y a la mañana siguiente la compra está en esta lista
// con todas las demás.
//
// Por qué es un mail aparte y no un renglón del aviso de alertas de plata: aquel avisa de un
// PROBLEMA (hay compras vencidas) y por eso solo se manda si lo hay. Esto es una lista de
// trabajo — lo que hay para pagar hoy — y tiene que llegar aunque nada esté vencido, porque
// el punto es pagar ANTES de que lo esté.
//
// Va los LUNES y no todos los días (decisión de Marcos). Lo que hay para pagar no cambia
// de un día para el otro —las facturas tienen plazo— así que un mail diario repetía casi
// la misma lista y se dejaba de abrir. Semanal cae cuando se arma la semana y se paga.
//
// Si no hay nada pendiente tampoco se manda: un mail que dice "no hay nada" se archiva sin
// abrir, y el que sí trae algo se archiva igual.
const CLAVE_CONFIG = 'email_pagos_pendientes';
const URL_GASTOS = 'https://xavia-self.vercel.app/gastos';

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : ''; };

// Cuánto falta, dicho como lo diría una persona. "en -3 d" obliga a traducir un signo menos
// para entender que algo está atrasado, que es justo lo que hay que ver de un vistazo.
function cuando(dias: number | null): { txt: string; color: string } {
  if (dias === null) return { txt: 'sin fecha', color: '#9ca3af' };
  if (dias < 0) return { txt: `vencida hace ${-dias} día${dias === -1 ? '' : 's'}`, color: '#b91c1c' };
  if (dias === 0) return { txt: 'vence HOY', color: '#b45309' };
  if (dias === 1) return { txt: 'vence mañana', color: '#b45309' };
  return { txt: `en ${dias} días`, color: dias <= 7 ? '#92400e' : '#6b7280' };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [gastos, config] = await Promise.all([
      readSheet<Gasto>('Gastos'),
      readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]),
    ]);

    const hoy = fechaArgentinaHoy();
    const r = resumenPagosPendientes(gastos, hoy);
    // `ver=1` para mirar qué saldría sin mandar nada. Es lo que permite revisar el mail sin
    // llenarle la casilla a nadie para probar.
    if (new URL(req.url).searchParams.get('ver') === '1') {
      return NextResponse.json({ hoy, ...r, lista: porVencimiento(r.proveedores) });
    }

    if (!r.cuantas) return NextResponse.json({ ok: true, enviado: false, hoy, motivo: 'no hay nada pendiente de pago' });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });

    const destinatarios = destinatariosDe(CLAVE_CONFIG, config);
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} no tiene ningún mail válido` }, { status: 500 });

    const lista = porVencimiento(r.proveedores);

    const filas = lista.map((p) => {
      const c = cuando(p.diasParaVencer);
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0">
          <strong>${p.proveedor}</strong><br>
          <span style="color:#6b7280;font-size:12px">${p.descripcion}</span>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:12.5px;color:${c.color};font-weight:${p.diasParaVencer !== null && p.diasParaVencer <= 1 ? 800 : 600}">
          ${c.txt}${p.vencimiento ? `<br><span style="color:#9ca3af;font-weight:400">${fmtDia(p.vencimiento)}</span>` : ''}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:12.5px;font-family:ui-monospace,monospace;color:${p.alias ? '#111' : '#d97706'}">
          ${p.alias || 'sin alias cargado'}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:800;white-space:nowrap">${fmt$(p.monto)}</td>
      </tr>`;
    }).join('');

    // El total por proveedor, que es como se paga de verdad: tres facturas de un proveedor
    // son una transferencia, no tres.
    const porProv = r.proveedores.map((p) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f5f5f5"><strong>${p.proveedor}</strong></td>
      <td style="padding:6px 10px;border-bottom:1px solid #f5f5f5;font-size:12px;font-family:ui-monospace,monospace;color:${p.alias ? '#374151' : '#d97706'}">${p.alias || 'sin alias'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f5f5f5;text-align:right;font-weight:700">${fmt$(p.total)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f5f5f5;text-align:right;font-size:12px;color:#b91c1c">${p.vencido > 0 ? `${fmt$(p.vencido)} vencido` : ''}</td>
    </tr>`).join('');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:680px">
        <h2 style="margin:0 0 4px">${r.cuantas} ${r.cuantas === 1 ? 'compra pendiente de pago' : 'compras pendientes de pago'} — ${fmt$(r.total)}</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
          ${r.vencido > 0
            ? `<strong style="color:#b91c1c">${fmt$(r.vencido)} ya está vencido.</strong> `
            : 'Nada vencido todavía. '}
          Son las compras cargadas con "todavía no lo pagué". Se marcan pagadas en Deuda a proveedores.
          Este aviso llega los lunes.
        </p>

        <h3 style="margin:0 0 6px;font-size:14px">Por vencimiento — en este orden hay que pagarlas</h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:6px 10px;text-align:left">Proveedor y compra</th>
            <th style="padding:6px 10px;text-align:left">Cuándo</th>
            <th style="padding:6px 10px;text-align:left">Alias para pagar</th>
            <th style="padding:6px 10px;text-align:right">Importe</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>

        <h3 style="margin:22px 0 6px;font-size:14px">Total por proveedor</h3>
        <p style="margin:0 0 8px;color:#6b7280;font-size:12.5px">Así es como se paga: una transferencia por proveedor, no una por compra.</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <tbody>${porProv}</tbody>
        </table>

        ${r.sinAlias > 0 ? `
        <p style="margin:18px 0 0;font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 12px">
          <strong>${r.sinAlias} ${r.sinAlias === 1 ? 'compra no tiene' : 'compras no tienen'} alias cargado.</strong>
          No es un error —se puede pagar en efectivo o con cheque— pero si va por transferencia, el alias hay que
          buscarlo en otro lado. Se carga al tildar "todavía no lo pagué".
        </p>` : ''}

        ${r.sinVencimiento > 0 ? `
        <p style="margin:10px 0 0;font-size:12px;color:#6b7280">
          ${r.sinVencimiento} ${r.sinVencimiento === 1 ? 'no tiene' : 'no tienen'} fecha de vencimiento, así que ${r.sinVencimiento === 1 ? 'va' : 'van'} al final de la lista.
        </p>` : ''}

        <p style="margin:18px 0 0">
          <a href="${URL_GASTOS}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Abrir Gastos y marcar las pagadas
          </a>
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        // El asunto lleva el número que decide si hay que abrirlo ahora o después.
        subject: r.vencido > 0
          ? `${fmt$(r.vencido)} vencido — ${r.cuantas} ${r.cuantas === 1 ? 'pago pendiente' : 'pagos pendientes'} por ${fmt$(r.total)}`
          : `${r.cuantas} ${r.cuantas === 1 ? 'pago pendiente' : 'pagos pendientes'} — ${fmt$(r.total)}`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, enviado: true, hoy, cuantas: r.cuantas, total: r.total, vencido: r.vencido, sinAlias: r.sinAlias, destinatarios });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
