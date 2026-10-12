import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { evaluarBandeja, CONFIG_ACTIVO, CONFIG_REMITENTES } from '@/lib/autoCobro';

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
// Mientras `auto_cobro_activo` no esté en SI, no registra nada: manda el mail diciendo qué
// habría registrado. Eso es a propósito — es código que escribe en la contabilidad y que no se
// pudo probar contra los datos reales. Una semana de ver la lista antes de prenderlo cuesta
// una semana; un cobro mal cargado en Xubio cuesta encontrarlo después.
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

    const filas = (xs: { cliente: string; importe: number; comprobantes?: string[]; retencion?: number; cuentaNombre?: string }[]) =>
      xs.map((c) => `
        <tr>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6">${c.cliente}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;text-align:right;font-weight:700">${fmt$(c.importe)}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;color:#6b7280">${c.retencion ? `ret. ${fmt$(c.retencion)}` : ''}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px">${(c.comprobantes || []).join(', ')}</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px">${c.cuentaNombre || ''}</td>
        </tr>`).join('');

    const bloque = (titulo: string, color: string, cuerpo: string) => cuerpo
      ? `<h3 style="margin:18px 0 6px;font-size:15px;color:${color}">${titulo}</h3>
         <table style="width:100%;border-collapse:collapse;font-size:13px">${cuerpo}</table>`
      : '';

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:700px">
        <h2 style="margin:0 0 4px">Cobros que se registran solos</h2>
        <p style="margin:0 0 10px;color:#555;font-size:13px">
          ${r.activo
            ? 'El registro automático está <strong>prendido</strong>.'
            : 'El registro automático está <strong>apagado</strong>: esto es lo que se habría registrado. Para prenderlo, poné <code>auto_cobro_activo = SI</code> en Configuración.'}
          Solo entran los avisos cuyas facturas suman exactamente lo que el aviso dice haber pagado, de un remitente habilitado
          (<code>${CONFIG_REMITENTES}</code>) y con el cliente y la cuenta reconocidos. Todo lo demás queda en la bandeja.
        </p>

        ${bloque(r.activo ? 'Registrados' : 'Se habrían registrado', '#166534', filas(
          r.activo
            ? r.registrados.map((x) => ({ cliente: x.cliente, importe: x.importe }))
            : r.candidatos))}

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
          ? `Cobros registrados solos: ${r.registrados.length}${r.errores.length ? ` · ${r.errores.length} con error` : ''}`
          : `${r.candidatos.length} cobro(s) se habrían registrado solos — ${CONFIG_ACTIVO} está apagado`,
        html,
      }),
    });

    return NextResponse.json({ ok: true, enviado: res.ok, ...r });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
