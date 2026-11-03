// ── Avisar en el momento en que un cobro se registra solo ────────────────────────────
//
// El resumen diario de auto-cobros ya existía, pero llega a las 12 del mediodía siguiente.
// Entre que el aviso de pago entra y ese mail pasan horas en las que la app registró una
// cobranza en Xubio y nadie se enteró.
//
// Eso es justamente lo que no puede pasar con lo único que la app hace sin preguntar: si
// algo se registró mal, el momento de verlo es ahora, cuando todavía se acuerda de qué
// aviso era. Así que este mail sale al instante, con una fila por cobro y el link para
// anularlo.
//
// El resumen diario NO se saca: sigue sirviendo para ver juntos los que quedaron para
// revisar a mano, que este mail no toca.

import type { ResultadoAuto } from './autoCobro';
import { destinatariosDe } from './avisosConfig';

export const CLAVE_AVISO_AUTO = 'email_cobro_automatico';
const URL_COBRANZAS = 'https://xavia-self.vercel.app/cobranzas';

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}/${y}` : String(f || ''); };

export async function avisarCobroRegistrado(
  ev: Pick<ResultadoAuto, 'registrados'>,
  config: { clave: string; valor: any }[],
): Promise<{ enviado: boolean; motivo?: string }> {
  const regs = ev.registrados || [];
  if (!regs.length) return { enviado: false, motivo: 'no se registró ninguno' };
  if (!process.env.RESEND_API_KEY) return { enviado: false, motivo: 'RESEND_API_KEY no configurada' };

  const destinatarios = destinatariosDe(CLAVE_AVISO_AUTO, config);
  if (!destinatarios.length) return { enviado: false, motivo: 'sin destinatarios' };

  const total = regs.reduce((a, r) => a + r.importe, 0);
  const hayProgramados = regs.some((r) => r.programado);

  const filas = regs.map((r) => `<tr>
    <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0"><strong>${r.cliente}</strong>
      ${r.programado ? '<span style="display:block;font-size:11px;color:#b45309;font-weight:700">pago programado</span>' : ''}
    </td>
    <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:#6b7280">${fmtDia(r.fecha)}</td>
    <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:800">${fmt$(r.importe)}
      ${r.retencion > 0 ? `<span style="display:block;font-size:11px;font-weight:400;color:#6b7280">+ ${fmt$(r.retencion)} retenidos</span>` : ''}
    </td>
    <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-family:ui-monospace,monospace;font-size:11.5px;color:#1d4ed8">${r.comprobantes.join('<br>')}</td>
    <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:11.5px">${r.cuentaNombre}${r.numeroRecibo ? `<br>recibo ${r.numeroRecibo}` : ''}</td>
  </tr>`).join('');

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:640px">
      <h2 style="margin:0 0 4px;font-size:18px;color:#166534">
        ${regs.length === 1 ? 'Se registró un cobro solo' : `Se registraron ${regs.length} cobros solos`} — ${fmt$(total)}
      </h2>
      <p style="margin:0 0 14px;color:#6b7280;font-size:13px">
        Llegó un aviso de pago y las facturas que nombra, abiertas y de ese cliente, suman exactamente lo que declara.
        Ya está en Xubio.
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:6px 10px;text-align:left">Cliente</th>
          <th style="padding:6px 10px;text-align:left">Fecha</th>
          <th style="padding:6px 10px;text-align:right">Importe</th>
          <th style="padding:6px 10px;text-align:left">Facturas</th>
          <th style="padding:6px 10px;text-align:left">Cuenta</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>

      ${hayProgramados ? `
        <p style="margin:12px 0 0;font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:9px 11px">
          Hay cobros de <strong>pagos programados</strong>: el aviso dice que la plata entra en esa fecha y todavía no
          entró. Se registran con esa fecha, así que hasta ese día el saldo de la cuenta muestra plata que no llegó.
          Si alguno no entra, se anula desde Cobranzas.
        </p>` : ''}

      <p style="margin:16px 0 0">
        <a href="${URL_COBRANZAS}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
          Ver en Cobranzas
        </a>
      </p>
      <p style="margin:12px 0 0;font-size:11.5px;color:#9ca3af;line-height:1.5">
        Esto sale en el momento en que pasa. Si algo quedó mal, se anula desde Cobranzas y la factura vuelve a figurar
        impaga. El resumen de los que quedaron para revisar a mano sigue llegando al mediodía siguiente.
      </p>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Xavia App <ventas@xavia.com.ar>',
      to: destinatarios,
      subject: `Cobro registrado solo: ${regs.map((r) => r.cliente).join(', ')} — ${fmt$(total)}`,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return { enviado: false, motivo: `Resend ${res.status}: ${err.slice(0, 150)}` };
  }
  return { enviado: true };
}
