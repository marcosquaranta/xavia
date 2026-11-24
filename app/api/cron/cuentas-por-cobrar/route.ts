import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, ConfigItem } from '@/lib/types';
import { comprobantesParaMirar, cobranzasParaMirar } from '@/lib/xubioLectura';
import { facturasPorCliente } from '@/lib/facturasCliente';
import { leerSaldadas, numerosSaldados } from '@/lib/facturasSaldadas';
import { leerEdiciones, imputacionesManuales } from '@/lib/cobranzasEdit';
import { leerAjustes, ajustesPorFactura } from '@/lib/ajusteFactura';
import { correccionesPorFactura } from '@/lib/correccionesFactura';
import { leerNotas } from '@/lib/notaCredito';
import { claveComprobante } from '@/lib/comprobantes';
import { nombreClienteVisible } from '@/lib/clientes';
import { HOJA_COBROS, type CobroRegistrado } from '@/lib/cobros';
import { destinatariosDe } from '@/lib/avisosConfig';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ── Cuentas por cobrar, cada 15 días ─────────────────────────────────────────────────
//
// Qué debe cada cliente, cuántas facturas y hace cuánto que está la más vieja. Es la foto
// que se mira para decidir a quién llamar, y hasta ahora había que entrar a Cobranzas y
// pedir el resumen de impagas a mano — que es justo lo que no se hace cuando nadie lo
// reclama.
//
// Sale los días 1 y 16. No lleva marca de "ya se mandó" como el reporte de precios: con un
// día exacto el cron no puede repetirse, porque corre una sola vez por día. El costo es que
// si justo ese día falla, se pierde esa vuelta y la siguiente llega en 15 días — a cambio
// de no poder mandarlo once veces, que es lo que pasó con el otro.
//
// El cálculo es el MISMO que el de la pantalla de Cobranzas, importado: impaga = ni
// imputada desde la app, ni cubierta por los cobros de Xubio, ni dada por saldada a mano.
// Si acá se decidiera distinto, el mail y la pantalla dirían cosas diferentes sobre la
// misma plata.
const CLAVE_CONFIG = 'email_cuentas_por_cobrar';
const DIAS_VENTANA = 365;
// A partir de cuántos días la factura más vieja se marca. No es una regla de cobranza: es
// dónde cortar para que el mail empiece por algo y no por los treinta clientes.
const DIAS_ALERTA = 45;
const URL_COBRANZAS = 'https://xavia-self.vercel.app/cobranzas?ver=impagas';

const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}/${y}` : String(f || ''); };
const fmt$ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`), b = Date.parse(`${hasta}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const soloVer = url.searchParams.get('ver') === '1';
  const forzar = url.searchParams.get('forzar') === 'si';

  const hoy = fechaArgentinaHoy();
  const dia = Number(hoy.slice(8, 10));
  if (!soloVer && !forzar && dia !== 1 && dia !== 16) {
    return NextResponse.json({ ok: true, enviado: false, hoy, motivo: `es el día ${dia}: sale el 1 y el 16` });
  }

  try {
    const desde = (() => {
      const d = new Date(`${hoy}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - DIAS_VENTANA);
      return d.toISOString().slice(0, 10);
    })();

    const [comps, cobranzas, clientes, cobros, saldadas, edicionesRaw, ajustesRaw, notas, config] = await Promise.all([
      comprobantesParaMirar(desde, hoy),
      cobranzasParaMirar(desde, hoy),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => [] as CobroRegistrado[]),
      leerSaldadas(),
      leerEdiciones(),
      leerAjustes(),
      leerNotas(),
      readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]),
    ]);

    const todas = facturasPorCliente(
      comps, cobros, clientes, numerosSaldados(saldadas), cobranzas,
      imputacionesManuales(edicionesRaw, claveComprobante),
      correccionesPorFactura(ajustesPorFactura(ajustesRaw), notas),
    );

    const filas: { cliente: string; monto: number; cantidad: number; masVieja: string; dias: number }[] = [];
    for (const [id, fs] of Object.entries(todas)) {
      const impagas = fs.filter((f) => !f.yaCobrada && !f.cubierta && !f.saldadaManual && !f.imputadaManual);
      if (!impagas.length) continue;
      const cli = clientes.find((c) => String(c.id_control) === String(id));
      const masVieja = impagas.map((f) => f.fecha).filter(Boolean).sort()[0] || '';
      filas.push({
        cliente: nombreClienteVisible(cli) || String(id),
        monto: impagas.reduce((a, f) => a + (Number(f.importe) || 0), 0),
        cantidad: impagas.length,
        masVieja,
        dias: masVieja ? diasEntre(masVieja, hoy) : 0,
      });
    }
    // Del que más debe al que menos: es el orden en el que se llama.
    filas.sort((a, b) => b.monto - a.monto);

    const total = filas.reduce((a, f) => a + f.monto, 0);
    const facturas = filas.reduce((a, f) => a + f.cantidad, 0);
    const viejos = filas.filter((f) => f.dias >= DIAS_ALERTA);

    if (soloVer) return NextResponse.json({ hoy, dia, clientes: filas.length, total, facturas, filas });

    if (!filas.length) return NextResponse.json({ ok: true, enviado: false, hoy, motivo: 'no hay nada por cobrar' });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });

    const destinatarios = destinatariosDe(CLAVE_CONFIG, config);
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} no tiene ningún mail válido` }, { status: 500 });

    const filasHtml = filas.map((f) => {
      const viejo = f.dias >= DIAS_ALERTA;
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0"><strong>${f.cliente}</strong></td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:800;white-space:nowrap">${fmt$(f.monto)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap">${f.cantidad}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;color:${viejo ? '#b91c1c' : '#6b7280'};font-weight:${viejo ? 800 : 600}">
          ${f.masVieja ? `${f.dias} días` : '—'}
          ${f.masVieja ? `<br><span style="font-weight:400;font-size:10.5px;color:#9ca3af">desde ${fmtDia(f.masVieja)}</span>` : ''}
        </td>
      </tr>`;
    }).join('');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:680px">
        <h2 style="margin:0 0 4px">Cuentas por cobrar — ${fmtDia(hoy)}</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
          <strong style="color:#111">${fmt$(total)}</strong> en ${facturas} ${facturas === 1 ? 'factura' : 'facturas'},
          repartidos en ${filas.length} ${filas.length === 1 ? 'cliente' : 'clientes'}. Del que más debe al que menos.
        </p>

        ${viejos.length ? `
        <div style="margin:0 0 16px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:7px">
          <p style="margin:0 0 3px;font-size:13px;font-weight:800;color:#b91c1c">
            ${viejos.length} ${viejos.length === 1 ? 'cliente arrastra' : 'clientes arrastran'} una factura de más de ${DIAS_ALERTA} días
          </p>
          <p style="margin:0;font-size:12.5px;color:#7f1d1d">
            ${viejos.slice(0, 8).map((f) => `${f.cliente} (${f.dias} d · ${fmt$(f.monto)})`).join(' · ')}${viejos.length > 8 ? ` y ${viejos.length - 8} más` : ''}
          </p>
        </div>` : ''}

        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:6px 10px;text-align:left">Cliente</th>
            <th style="padding:6px 10px;text-align:right">Debe</th>
            <th style="padding:6px 10px;text-align:right">Facturas</th>
            <th style="padding:6px 10px;text-align:right">La más vieja</th>
          </tr></thead>
          <tbody>${filasHtml}</tbody>
        </table>

        <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">
          Impaga = ni imputada desde la app, ni cubierta por los cobros que el cliente tiene en Xubio, ni dada por
          saldada a mano. Es el mismo criterio de la pantalla de Cobranzas, así que los números coinciden.
          Las notas de crédito ya están descontadas.
          <br>Llega el 1 y el 16 de cada mes.
        </p>

        <p style="margin:18px 0 0">
          <a href="${URL_COBRANZAS}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Ver el detalle factura por factura
          </a>
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: `Cuentas por cobrar — ${fmt$(total)} en ${filas.length} cliente(s)`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, enviado: true, hoy, clientes: filas.length, total, facturas, destinatarios });
  } catch (err: any) {
    console.error('[cron/cuentas-por-cobrar] error:', err);
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
