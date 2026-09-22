import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { HOJA_BANDEJA, type ItemBandeja } from '@/lib/bandejaCobranzas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DESTINATARIOS = ['administracion@xavia.com.ar'];
const URL_BANDEJA = 'https://xavia-self.vercel.app/cobranzas';

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : String(f || ''); };

// Aviso diario de cobros por imputar.
//
// La bandeja se llena sola —el resumen del banco y los avisos de pago reenviados entran
// sin que nadie los pida—, y una bandeja que se llena sola y que nadie abre es peor que no
// tenerla: da la sensación de que los cobros están al día cuando en realidad están sin
// imputar. Por eso el aviso sale UNA vez por día y solo si hay algo que hacer.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const filas = await readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => [] as ItemBandeja[]);
    const pendientes = filas.filter((i) => String(i.estado || '').trim() === 'pendiente');

    // Sin nada por imputar no se manda nada. Un mail diario que casi siempre dice "no hay
    // nada" enseña a ignorarlo, y el día que traiga algo tampoco se va a leer.
    if (!pendientes.length) return NextResponse.json({ ok: true, enviado: false, motivo: 'sin pendientes' });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });

    // La confirmación de reenvío de Gmail no es un cobro, pero sí algo que hay que mirar:
    // va aparte porque la acción es distinta (copiar un código, no imputar plata).
    const cobros = pendientes.filter((i) => String(i.origen) !== 'setup');
    const setup = pendientes.filter((i) => String(i.origen) === 'setup');

    const total = cobros.reduce((a, i) => a + (Number(i.importe) || 0), 0);
    const sinReconocer = cobros.filter((i) => !String(i.id_control || '').trim()).length;

    const filasHtml = cobros
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      .slice(0, 25)
      .map((i) => {
        const reconocido = !!String(i.id_control || '').trim();
        return `<tr>
          <td style="padding:5px 9px;border-bottom:1px solid #eee;white-space:nowrap">${fmtDia(String(i.fecha))}</td>
          <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${fmt$(Number(i.importe) || 0)}</td>
          <td style="padding:5px 9px;border-bottom:1px solid #eee;color:${reconocido ? '#166534' : '#b45309'}">${reconocido ? i.cliente : 'sin reconocer'}</td>
          <td style="padding:5px 9px;border-bottom:1px solid #eee;color:#6b7280;font-size:12px">${String(i.origen || '')}</td>
          <td style="padding:5px 9px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;color:#1d4ed8">${String(i.comprobantes || '')}</td>
        </tr>`;
      }).join('');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:640px">
        <h2 style="margin:0 0 6px">Hay cobros para imputar</h2>
        <p style="margin:0 0 14px;color:#555">
          ${cobros.length} ${cobros.length === 1 ? 'movimiento' : 'movimientos'} sin imputar por <strong>${fmt$(total)}</strong>${
            sinReconocer > 0 ? ` · <span style="color:#b45309">${sinReconocer} sin reconocer al cliente</span>` : ''}.
        </p>
        <p style="margin:0 0 16px">
          <a href="${URL_BANDEJA}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Abrir la bandeja de cobranzas
          </a>
        </p>
        ${cobros.length ? `<table style="border-collapse:collapse;width:100%;font-size:13px">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:5px 9px;text-align:left">Fecha</th>
            <th style="padding:5px 9px;text-align:right">Importe</th>
            <th style="padding:5px 9px;text-align:left">Cliente</th>
            <th style="padding:5px 9px;text-align:left">Origen</th>
            <th style="padding:5px 9px;text-align:left">Facturas</th>
          </tr></thead>
          <tbody>${filasHtml}</tbody>
        </table>` : ''}
        ${cobros.length > 25 ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af">…y ${cobros.length - 25} más.</p>` : ''}
        ${setup.length ? `<p style="margin:16px 0 0;padding:9px 11px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:13px;color:#92400e">
          Además hay ${setup.length} ${setup.length === 1 ? 'mensaje' : 'mensajes'} de configuración esperando en la bandeja (confirmación de reenvío de Gmail).
        </p>` : ''}
        <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">
          Este aviso sale una vez por día y solo cuando hay algo para imputar. Nada se registra en Xubio hasta que lo confirmás.
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: DESTINATARIOS,
        subject: `${cobros.length} ${cobros.length === 1 ? 'cobro' : 'cobros'} para imputar — ${fmt$(total)}`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[bandeja-pendiente] Resend rechazó el aviso:', err);
      return NextResponse.json({ ok: false, error: 'no se pudo enviar' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, enviado: true, pendientes: cobros.length, total });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
  }
}
