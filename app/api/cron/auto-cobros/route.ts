import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { evaluarBandeja, CONFIG_ACTIVO } from '@/lib/autoCobro';
import { readSheet } from '@/lib/sheets';
import type { ConfigItem } from '@/lib/types';
import { destinatariosDe } from '@/lib/avisosConfig';
import { CLAVE_AVISO_AUTO, cobrosAutomaticosSinAvisar, marcarAvisados } from '@/lib/avisoCobroAutomatico';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// A quién le llega: la misma configuración que el aviso instantáneo, editable en
// Admin → Avisos por mail. Estaba escrito a mano acá, y dos lugares donde decir a quién le
// llega es uno que se queda atrás el día que cambie.
const DESTINATARIOS_POR_DEFECTO = ['administracion@xavia.com.ar'];
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
//
// ── Este mail es EL resumen del día ─────────────────────────────────────────
//
// La mayoría de los cobros no se registran en esta corrida: se registran cuando el aviso de
// pago entra, horas antes (ver /api/cobranzas/email). Antes cada uno de esos mandaba su
// propio mail, y eran varios por día que no pedían nada.
//
// Entonces lo que se lista acá NO es lo que registró esta corrida: son todos los cobros
// automáticos que todavía no se avisaron, leídos de la hoja de Cobros y marcados al
// mandarlos. Así ninguno sale dos veces ni se pierde si un día el cron no corre.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const r = await evaluarBandeja();
    // Todos los cobros automáticos sin avisar — los que acaba de registrar esta corrida y
    // los que se registraron solos cuando entró cada aviso. Las cuentas vienen de la misma
    // corrida para poder poner el nombre al lado del id.
    const delDia = await cobrosAutomaticosSinAvisar(r.cuentas || []).catch(() => []);
    const cfgRows = await readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]);
    const configurados = destinatariosDe(CLAVE_AVISO_AUTO, cfgRows);
    // Administración sigue recibiéndolo aunque el aviso instantáneo vaya a otra persona:
    // este resumen es el control de la corrida, no la notificación de un cobro puntual.
    const destinatarios = [...new Set([...DESTINATARIOS_POR_DEFECTO, ...configurados])];

    // Sin candidatos no se manda nada. El aviso diario de la bandeja ya avisa que hay cosas
    // por imputar; un segundo mail que casi siempre dice "no hubo ninguno" enseña a ignorar
    // los dos.
    if (!delDia.length && !r.candidatos.length && !r.errores.length) {
      return NextResponse.json({ ok: true, enviado: false, activo: r.activo, rechazados: r.rechazados.length });
    }
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada', ...r }, { status: 500 });
    }

    const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : String(f || ''); };

    interface FilaMail {
      cliente: string; importe: number; fecha?: string;
      comprobantes?: string[]; retencion?: number; cuentaNombre?: string; numeroRecibo?: string;
      // La cuenta no salió del aviso: se usó la última de ese cliente o la de siempre. Es el
      // único dato del cobro que a veces hay que corregir, así que se marca.
      cuentaDudosa?: boolean;
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
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px">${c.cuentaNombre || ''}${
            c.cuentaDudosa ? '<br><span style="color:#b45309;font-size:11px">el aviso no la decía</span>' : ''
          }</td>
          <td style="padding:5px 8px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px">${c.numeroRecibo || ''}</td>
        </tr>`).join('');

    const bloque = (titulo: string, color: string, cuerpo: string) => cuerpo
      ? `<h3 style="margin:18px 0 6px;font-size:15px;color:${color}">${titulo}</h3>
         <table style="width:100%;border-collapse:collapse;font-size:13px">${cuerpo}</table>`
      : '';

    const totalRegistrado = delDia.reduce((a, x) => a + x.importe, 0);
    const totalRetenido = delDia.reduce((a, x) => a + x.retencion, 0);

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

        ${bloque(r.activo ? 'Imputados en Xubio' : 'Se habrían imputado', '#166534', filas(r.activo ? delDia : r.candidatos))}
        ${r.activo && delDia.length ? `<p style="margin:8px 0 0;font-size:13px">
          <strong>${delDia.length} cobro(s) · ${fmt$(totalRegistrado)}</strong>${totalRetenido ? ` · ${fmt$(totalRetenido)} de retenciones` : ''}
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
        ${delDia.some((x) => x.retencion > 0) ? `
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
        to: destinatarios,
        subject: r.activo
          ? `Cobros registrados solos: ${delDia.length} · ${fmt$(totalRegistrado)}${r.errores.length ? ` · ${r.errores.length} con error` : ''}`
          : `${r.candidatos.length} cobro(s) se habrían imputado solos — ${CONFIG_ACTIVO} está en NO`,
        html,
      }),
    });

    // Marcados recién ahora: si Resend rechazó el mail, estos cobros tienen que volver a
    // salir mañana en vez de quedar avisados sin que nadie los haya visto.
    if (res.ok) await marcarAvisados(delDia);

    return NextResponse.json({ ok: true, enviado: res.ok, avisados: res.ok ? delDia.length : 0, ...r });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
