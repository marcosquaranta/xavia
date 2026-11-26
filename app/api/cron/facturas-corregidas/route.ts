import { NextRequest, NextResponse } from 'next/server';
import { readSheet, updateRow, asegurarColumnas } from '@/lib/sheets';
import { HOJA_AJUSTES, type AjusteFactura } from '@/lib/ajusteFactura';
import { HOJA_NOTAS, type NotaCreditoRegistrada } from '@/lib/notaCredito';
import { HOJA_FACT_CORRECCION, type FacturaPorCorreccion } from '@/lib/facturaCorreccion';
import { destinatariosDe } from '@/lib/avisosConfig';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CLAVE_CONFIG = 'email_alertas_plata';
const BASE = 'https://xavia-self.vercel.app';

// ── Aviso: una factura emitida dejó de decir lo que se cobra ─────────────────────────
//
// Qué pasa hoy cuando se corrige una venta ya facturada, que es justo lo que no estaba
// dicho en ningún lado: NO se emite una nota de crédito sola. Se anota un ajuste —para esta
// factura, cobrar X en vez de Y— y el comprobante de Xubio queda exactamente como estaba.
// La app reclama el importe corregido; AFIP sigue viendo el original.
//
// Eso es deliberado: emitir una NC es un acto fiscal y no puede dispararse porque alguien
// arregló una cantidad en una pantalla. Pero deja una diferencia abierta entre lo que dice
// el comprobante y lo que se cobra, y esa diferencia no aparecía en ningún lado hasta que
// alguien fuera a buscarla a la hoja de ajustes.
//
// Entonces: un mail cuando pasa. No para que alguien corra, sino para que la decisión de
// emitir o no la nota de crédito la tome una persona, sabiendo que hay una pendiente.
//
// Las notas de crédito que SÍ se emitieron desde la app van en el mismo mail: son las dos
// caras de la misma pregunta —qué se hizo con las facturas corregidas— y separarlas en dos
// avisos obligaría a cruzar dos mails para contestarla.
export async function GET(req: NextRequest) {
  const soloVer = req.nextUrl.searchParams.get('ver') === '1';
  try {
    await asegurarColumnas(HOJA_AJUSTES, ['avisado']).catch(() => null);
    await asegurarColumnas(HOJA_NOTAS, ['avisado']).catch(() => null);
    await asegurarColumnas(HOJA_FACT_CORRECCION, ['avisado']).catch(() => null);

    const [ajustes, notas, config] = await Promise.all([
      readSheet<AjusteFactura & { avisado?: string }>(HOJA_AJUSTES).catch(() => []),
      readSheet<NotaCreditoRegistrada & { avisado?: string }>(HOJA_NOTAS).catch(() => []),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
    ]);
    // Las facturas que se emitieron por una correccion que SUMO. Van en el mismo mail: son
    // la otra mitad de la misma pregunta —que se hizo con las facturas corregidas— y
    // separarlas en dos avisos obligaria a cruzar dos mails para contestarla.
    const extras = await readSheet<FacturaPorCorreccion>(HOJA_FACT_CORRECCION).catch(() => []);

    const sinAvisar = <T extends { avisado?: string }>(filas: T[]) =>
      filas.filter((f) => String(f?.avisado || '').trim().toUpperCase() !== 'SI');

    // Un ajuste revertido ya no dice nada: alguien lo deshizo antes de que saliera el aviso.
    const nuevosAjustes = sinAvisar(ajustes).filter((a) => String(a.estado || 'activo') !== 'revertido');
    const nuevasNotas = sinAvisar(notas).filter((n) => String(n.estado || '') !== 'anulada');
    const nuevasExtras = sinAvisar(extras as any).filter((f: any) => String(f.estado || '') !== 'anulada') as FacturaPorCorreccion[];

    const resumen = {
      ajustes: nuevosAjustes.length,
      notas: nuevasNotas.length,
      diferencia: nuevosAjustes.reduce((a, x) => a + (Number(x.importe_xubio) || 0) - (Number(x.importe_app) || 0), 0),
    };

    if (soloVer) return NextResponse.json({ ok: true, ...resumen, extras: nuevasExtras.length, nuevosAjustes, nuevasNotas, nuevasExtras });
    if (!nuevosAjustes.length && !nuevasNotas.length && !nuevasExtras.length) {
      return NextResponse.json({ ok: true, enviado: false, motivo: 'no hay facturas corregidas sin avisar' });
    }
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });
    const destinatarios = destinatariosDe(CLAVE_CONFIG, config);
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} sin destinatarios` }, { status: 500 });

    const $ = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
    const fmtDia = (f: any) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : String(f || ''); };

    const filaAjuste = (a: AjusteFactura) => {
      const dif = (Number(a.importe_xubio) || 0) - (Number(a.importe_app) || 0);
      return `<tr>
        <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace;font-size:11.5px">${a.numero}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6">${a.cliente || ''}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;color:#6b7280">${fmtDia(a.fecha_ajuste)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280">${$(a.importe_xubio)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700">${$(a.importe_app)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;color:${dif > 0 ? '#991b1b' : '#166534'}">
          ${dif > 0 ? '−' : '+'}${$(Math.abs(dif))}
        </td>
      </tr>${a.motivo ? `<tr><td colspan="6" style="padding:0 8px 6px 8px;font-size:11px;color:#9ca3af">${a.motivo}</td></tr>` : ''}`;
    };

    // ── Lo único que hay que hacer, arriba de todo ──────────────────────────────
    //
    // El mail junta tres cosas distintas y sólo UNA pide algo: los ajustes sin nota de
    // crédito, que dejan una diferencia abierta entre Xubio y lo que se cobra. Las notas
    // emitidas y las facturas nuevas ya están cerradas de los dos lados.
    //
    // Salía todo en marrón de alerta y con el mismo título, así que un mail donde no había
    // nada que hacer se leía igual que uno donde sí. Ahora el color y la primera línea
    // dicen cuál de los dos es antes de leer las tablas.
    const hayPendiente = nuevosAjustes.length > 0;
    const color = hayPendiente ? '#92400e' : '#166534';

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:700px">
        <h2 style="margin:0 0 4px;font-size:18px;color:${color}">Facturas corregidas después de emitidas</h2>
        <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:${hayPendiente ? '#92400e' : '#166534'}">
          ${hayPendiente
            ? 'Hay <strong>una diferencia abierta</strong>: el comprobante de Xubio dice un importe y la app reclama otro. Mirá la primera tabla.'
            : 'Esto es <strong>para que lo sepas, no para que hagas nada</strong>: lo que se corrigió ya quedó emitido en Xubio de los dos lados.'}
        </p>

        ${nuevosAjustes.length ? `
          <p style="margin:0 0 10px;font-size:12.5px;color:#6b7280;line-height:1.55">
            <strong>${nuevosAjustes.length} factura(s)</strong> se corrigieron en la app y <strong>NO se emitió nota de crédito</strong>.
            El comprobante en Xubio sigue diciendo el importe original; lo que cambió es lo que la app reclama y da por pendiente.
            Formalmente, lo que corresponde para cerrarlas es una nota de crédito — se emite desde el historial de facturación,
            y al emitirla el ajuste se anula solo para que la deuda no baje dos veces.
          </p>
          <table style="border-collapse:collapse;width:100%;font-size:12.5px">
            <thead><tr style="background:#f5f5f5">
              <th style="padding:5px 8px;text-align:left">Factura</th>
              <th style="padding:5px 8px;text-align:left">Cliente</th>
              <th style="padding:5px 8px;text-align:left">Corregida</th>
              <th style="padding:5px 8px;text-align:right">Dice Xubio</th>
              <th style="padding:5px 8px;text-align:right">Se cobra</th>
              <th style="padding:5px 8px;text-align:right">Diferencia</th>
            </tr></thead>
            <tbody>${nuevosAjustes.map(filaAjuste).join('')}</tbody>
          </table>` : ''}

        ${nuevasNotas.length ? `
          <p style="margin:18px 0 6px;font-size:13px;font-weight:800;color:#166534">Notas de crédito emitidas</p>
          <p style="margin:0 0 6px;font-size:12px;color:#6b7280">Estas sí entraron en Xubio: la factura quedó corregida de los dos lados.</p>
          <table style="border-collapse:collapse;width:100%;font-size:12.5px">
            <thead><tr style="background:#f5f5f5">
              <th style="padding:5px 8px;text-align:left">NC</th>
              <th style="padding:5px 8px;text-align:left">Sobre la factura</th>
              <th style="padding:5px 8px;text-align:left">Cliente</th>
              <th style="padding:5px 8px;text-align:right">Importe</th>
            </tr></thead>
            <tbody>${nuevasNotas.map((n) => `<tr>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace;font-size:11.5px">${n.numero_nc}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace;font-size:11.5px">${n.numero_factura}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6">${n.cliente || ''}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700">${$(n.importe)}</td>
            </tr>`).join('')}</tbody>
          </table>` : ''}

        ${nuevasExtras.length ? `
          <p style="margin:18px 0 6px;font-size:13px;font-weight:800;color:#1e40af">Se facturó de más porque la corrección agregó mercadería</p>
          <p style="margin:0 0 6px;font-size:12px;color:#6b7280;line-height:1.55">
            A estas ventas se les sumó mercadería después de facturarlas. Lo que se agregó salió en una factura
            <strong>nueva</strong> — no se tocó la original, que sigue valiendo por lo suyo.
            <strong>Ya están las dos en Xubio y en la deuda del cliente: no hay nada que hacer con estas.</strong>
          </p>
          <table style="border-collapse:collapse;width:100%;font-size:12.5px">
            <thead><tr style="background:#f5f5f5">
              <th style="padding:5px 8px;text-align:left">Cliente</th>
              <th style="padding:5px 8px;text-align:left">Se le agregó a la factura</th>
              <th style="padding:5px 8px;text-align:left">Con esta factura nueva</th>
              <th style="padding:5px 8px;text-align:right">De más</th>
            </tr></thead>
            <tbody>${nuevasExtras.map((f) => `<tr>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6"><strong>${f.cliente || ''}</strong></td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace;font-size:11.5px;color:#6b7280">${f.numero_original}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace;font-size:11.5px">${f.numero_nuevo}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;color:#1e40af">+ ${$(f.importe)}</td>
            </tr>${f.detalle ? `<tr><td colspan="4" style="padding:0 8px 6px 8px;font-size:11px;color:#9ca3af">${f.detalle}</td></tr>` : ''}`).join('')}</tbody>
          </table>` : ''}

        <p style="margin:18px 0 0">
          <a href="${BASE}/ventas/historial" style="background:${color};color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Ver el historial de facturación
          </a>
        </p>
        <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">
          Cada factura sale una sola vez en este mail. Si no llega, es que no se corrigió ninguna.
        </p>
      </div>`;

    const cuantas = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
    const partesAsunto = [
      nuevosAjustes.length ? `${cuantas(nuevosAjustes.length, 'factura corregida', 'facturas corregidas')} sin nota de crédito` : '',
      nuevasNotas.length ? cuantas(nuevasNotas.length, 'nota de crédito emitida', 'notas de crédito emitidas') : '',
      nuevasExtras.length ? `${cuantas(nuevasExtras.length, 'factura nueva', 'facturas nuevas')} por corrección que sumó` : '',
    ].filter(Boolean);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        // El asunto nombra lo que el mail trae, no una de las tres cosas elegida de
        // antemano. Decía "0 nota(s) de crédito emitidas" cuando lo único que había era una
        // factura nueva: un cero en el asunto de un mail que no estaba vacío.
        subject: partesAsunto.join(' · ') || 'Facturas corregidas después de emitidas',
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    // Se marca DESPUÉS de que el mail salió. Al revés, un error de Resend dejaría las
    // facturas marcadas como avisadas sin que nadie se haya enterado nunca.
    for (const a of nuevosAjustes) await updateRow(HOJA_AJUSTES, 'numero', String(a.numero), { avisado: 'SI' }).catch(() => null);
    for (const n of nuevasNotas) await updateRow(HOJA_NOTAS, 'numero_nc', String(n.numero_nc), { avisado: 'SI' }).catch(() => null);
    for (const f of nuevasExtras) await updateRow(HOJA_FACT_CORRECCION, 'numero_nuevo', String(f.numero_nuevo), { avisado: 'SI' }).catch(() => null);

    return NextResponse.json({ ok: true, enviado: true, ...resumen });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}
