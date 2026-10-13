import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { evaluarBandeja, CONFIG_ACTIVO } from '@/lib/autoCobro';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const DESTINATARIOS = ['administracion@xavia.com.ar'];
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

// ── Registro automático de los cobros que no necesitan criterio ───────────────────────
//
// Corre todos los días. Mira la bandeja y separa los avisos de pago cuyas facturas suman
// EXACTAMENTE lo que el aviso dice haber pagado: esos no necesitan que nadie los mire, porque
// no hay nada que interpretar. El resto queda en la bandeja como siempre.
//
// Está prendido. El freno de mano es `auto_cobro_activo = NO` en Configuración: con eso vuelve
// a solo informar qué habría registrado, sin tocar nada.
//
// El mail de confirmación sale siempre que haya pasado algo, y trae el detalle completo —
// cliente, importe, retención, facturas, cuenta y número de recibo— para que se pueda
// controlar sin entrar a la app. Un "se registraron 3 cobros" obliga a ir a mirar qué fueron,
// que es justo el trabajo que esto viene a sacar.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const r = await evaluarBandeja();

    // Sin candidatos no se manda nada. El aviso diario de la bandeja ya avisa que hay cosas
    // por imputar; un segundo mail que casi siempre dice "no hubo ninguno" enseña a ignorar
    // los dos.
    if (!r.candidatos.length && !r.registrados.length && !r.errores.length) {
      return NextResponse.json({ ok: true, enviado: false, activo: r.activo, rechazados: r.rechazados.length });
    }
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada', ...r }, { status: 500 });
    }

    const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : String(f || ''); };

    interface FilaMail {
      cliente: string; importe: number; fecha?: string;
      comprobantes?: string[]; retencion?: number; cuentaNombre?: string; numeroRecibo?: string;
    }
    const filas = (xs: FilaMail[]) => `
      <tr style="background:#fafaf9;color:#6b7280;font-size:11px;text-transform:uppercase">
        <td style="padding:4px 8px">Cliente</td>
        <td style="padding:4px 8px">Fecha</td>
        <td style="padding:4px 8px;text-align:right">Importe</td>
        <td style="padding:4px 8px;text-align:right">Retención</td>
        <td style="padding:4px 8px">Facturas</td>
        <td style="padding:4px 8px">Cuenta</td>
        <td style="padding:4px 8px">Recibo</td>
      </tr>` + xs.map((c) => `
        <tr>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;font-weight:600">${c.cliente}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;color:#6b7280">${fmtDia(c.fecha || '')}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;text-align:right;font-weight:700">${fmt$(c.importe)}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;text-align:right;color:${c.retencion ? '#b45309' : '#d1d5db'}">${c.retencion ? fmt$(c.retencion) : '—'}${c.retencion ? '<br><span style="font-size:10px;color:#6b7280">como gasto</span>' : ''}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;color:#374151;font-size:12px">${(c.comprobantes || []).join(', ')}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px">${c.cuentaNombre || ''}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px">${c.numeroRecibo || ''}</td>
        </tr>`).join('');

    const bloque = (titulo: string, color: string, cuerpo: string) => cuerpo
      ? `<h3 style="margin:18px 0 6px;font-size:15px;color:${color}">${titulo}</h3>
         <table style="width:100%;border-collapse:collapse;font-size:13px">${cuerpo}</table>`
      : '';

    const totalRegistrado = r.registrados.reduce((a, x) => a + x.importe, 0);
    const totalRetenido = r.registrados.reduce((a, x) => a + x.retencion, 0);

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:700px">
        <h2 style="margin:0 0 4px">Cobros que se registran solos</h2>
        <p style="margin:0 0 10px;color:#555;font-size:13px">
          ${r.activo
            ? 'Esto <strong>ya quedó imputado</strong> en Xubio y en la app: no hay que hacer nada. Está acá para controlarlo.'
            : 'El registro automático está <strong>apagado</strong> (<code>auto_cobro_activo = NO</code>): esto es lo que se habría imputado.'}
          Entra cualquier cliente cuyo aviso nombre las facturas: lo que habilita el registro no es quién manda el mail,
          sino que esas facturas —abiertas y de ese cliente— sumen <strong>al peso</strong> lo que el aviso declara pagado,
          más lo retenido. Además tienen que estar reconocidos el cliente y la cuenta de destino. Todo lo demás queda en la
          bandeja para imputar a mano.
        </p>

        ${bloque(r.activo ? 'Imputados en Xubio' : 'Se habrían imputado', '#166534', filas(r.activo ? r.registrados : r.candidatos))}
        ${r.activo && r.registrados.length ? `<p style="margin:8px 0 0;font-size:13px">
          <strong>${r.registrados.length} cobro(s) · ${fmt$(totalRegistrado)}</strong>${totalRetenido ? ` · ${fmt$(totalRetenido)} de retenciones` : ''}
        </p>` : ''}

        ${r.errores.length ? `<h3 style="margin:18px 0 6px;font-size:15px;color:#b91c1c">No se pudieron registrar</h3>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151">
            ${r.errores.map((e) => `<li>${e.cliente}: ${e.error}</li>`).join('')}
          </ul>` : ''}

        ${r.rechazados.length ? `<h3 style="margin:18px 0 6px;font-size:15px;color:#92400e">Quedan para revisar a mano</h3>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151">
            ${r.rechazados.slice(0, 25).map((x) => `<li>${x.cliente} ${fmt$(x.importe)} — ${x.motivo}</li>`).join('')}
          </ul>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280">
            Estos no son errores: son los casos donde hace falta mirar. Se imputan como siempre desde Cobranzas.
          </p>` : ''}
        ${r.registrados.some((x) => x.retencion > 0) ? `
          <p style="margin:12px 0 0;font-size:12.5px;color:#374151;background:#fafaf9;border:1px solid #e5e7eb;border-radius:7px;padding:9px 11px">
            Los cobros con retención se registran en Xubio por el <strong>total de la factura</strong>, así que allá la factura
            queda cancelada entera. Acá la retención se carga como <strong>gasto</strong> de la misma cuenta, de modo que el
            saldo de esa cuenta refleja lo que entró de verdad y el monto retenido aparece en el resultado.
          </p>` : ''}

        <p style="margin:18px 0 0;font-size:12px;color:#6b7280">
          Lo que habilita el registro automático no es confiar en el mail: es que las facturas nombradas, abiertas y de ese
          cliente, sumen al peso lo que el aviso declara. Si no da, no se registra.
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia <ventas@xavia.com.ar>',
        to: DESTINATARIOS,
        subject: r.activo
          ? `Cobros imputados solos: ${r.registrados.length} · ${fmt$(totalRegistrado)}${r.errores.length ? ` · ${r.errores.length} con error` : ''}`
          : `${r.candidatos.length} cobro(s) se habrían imputado solos — ${CONFIG_ACTIVO} está en NO`,
        html,
      }),
    });

    return NextResponse.json({ ok: true, enviado: res.ok, ...r });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
