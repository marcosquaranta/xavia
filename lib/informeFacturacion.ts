// ── Informe de control de facturación ────────────────────────────────────────────────
//
// Sale por separado del reporte semanal, a pedido de Marcos. No es un capricho de formato:
// el reporte semanal lo mira quien quiere saber cómo viene la producción, y este lo mira
// quien va a ir a corregir una factura. Mezclados, el de facturación se leía por encima
// junto con todo lo demás y nunca se accionaba.
//
// Lo que compara está en lib/controlFacturacion.ts: lo que la app dio por facturado contra
// lo que hay en Xubio, cliente por cliente y día por día, ya con el IVA de la factura A y
// con el corrimiento de un día contemplados.

import { readSheet } from './sheets';
import { compararFacturado, controlFacturacion, DIF_MINIMA_PESOS, type ComparacionFacturado, type ControlFacturacion } from './controlFacturacion';
import { comprobantesParaMirar } from './xubioLectura';
import { fechaArgentinaHoy } from './ocupacion';
import type { VentaDia, PrecioVenta, ClienteVenta } from './types';
import { cobranzasParaMirar } from './xubioLectura';
import { medirDependencia, type Dependencia } from './dependenciaXubio';
import { HOJA_COBROS, type CobroRegistrado } from './cobros';

const DIAS_VENTANA = 30;

const fmtMoneda = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (iso: string) => { const [, m, d] = String(iso || '').split('-'); return d ? `${d}/${m}` : iso; };

export interface DatosInformeFacturacion {
  desde: string;
  hasta: string;
  comparacion: ComparacionFacturado;
  control: ControlFacturacion;
  // Cuánto de lo que hay en Xubio NO salió de la app. Es el indicador de si el objetivo
  // —que Xubio sea solo donde se emite— es real o es una intención.
  dependencia: Dependencia;
}

export async function obtenerDatosInformeFacturacion(): Promise<DatosInformeFacturacion> {
  const hasta = fechaArgentinaHoy();
  const d = new Date(hasta + 'T12:00:00');
  d.setDate(d.getDate() - (DIAS_VENTANA - 1));
  const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const [ventas, precios, clientes, comprobantes, cobranzas, cobros] = await Promise.all([
    readSheet<VentaDia>('Ventas'),
    readSheet<PrecioVenta>('Precios'),
    readSheet<ClienteVenta>('Clientes'),
    comprobantesParaMirar(desde, hasta),
    cobranzasParaMirar(desde, hasta),
    readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => [] as CobroRegistrado[]),
  ]);

  return {
    desde, hasta,
    comparacion: compararFacturado(ventas, precios, clientes, comprobantes, desde, hasta),
    control: controlFacturacion(ventas, precios, clientes, hasta),
    dependencia: medirDependencia({
      comprobantes, cobranzas, desde, hasta,
      emitidosPorLaApp: ventas.map((v) => v.exportado).filter((x) => x && x !== 'PENDIENTE'),
      recibosDeLaApp: cobros.filter((c) => String(c.estado) !== 'anulado').map((c) => c.numero_recibo),
    }),
  };
}

export function construirHtmlFacturacion(d: DatosInformeFacturacion): string {
  const c = d.comparacion;

  const pendientesHtml = !d.control.pendientes.length
    ? '<p style="margin:0;font-size:13px;color:#059669">✓ No quedó nada sin facturar.</p>'
    : `<table style="border-collapse:collapse;width:100%;font-size:12.5px">
        <thead><tr style="background:#f9fafb;color:#6b7280">
          <th style="padding:5px 8px;text-align:left">Cliente</th>
          <th style="padding:5px 8px;text-align:right">Unidades</th>
          <th style="padding:5px 8px;text-align:right">Monto</th>
          <th style="padding:5px 8px;text-align:left">Desde</th>
        </tr></thead>
        <tbody>${d.control.pendientes.map((p) => `<tr>
          <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6">${p.cliente}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right">${p.unidades.toLocaleString('es-AR')}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700">${fmtMoneda(p.monto)}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;color:${p.atraso > 3 ? '#dc2626' : '#6b7280'}">${fmtDia(p.diaMasViejo)} (${p.atraso} días)</td>
        </tr>`).join('')}</tbody>
      </table>`;

  const difHtml = !c.disponible
    ? '<p style="margin:0;font-size:12px;color:#9ca3af">No se pudo leer Xubio para contrastar.</p>'
    : !c.porCliente.length
      ? `<p style="margin:0;font-size:13px;color:#059669">✓ Ningún cliente con diferencias de más de ${fmtMoneda(DIF_MINIMA_PESOS)}.</p>`
      : `<table style="border-collapse:collapse;width:100%;font-size:12.5px">
          <thead><tr style="background:#f9fafb;color:#6b7280">
            <th style="padding:5px 8px;text-align:left">Cliente</th>
            <th style="padding:5px 8px;text-align:right">Según la app</th>
            <th style="padding:5px 8px;text-align:right">En Xubio</th>
            <th style="padding:5px 8px;text-align:right">Diferencia</th>
          </tr></thead>
          <tbody>${c.porCliente.map((x) => `<tr>
              <td style="padding:5px 8px;border-bottom:${x.dias.length ? 'none' : '1px solid #f3f4f6'}">${x.cliente}</td>
              <td style="padding:5px 8px;border-bottom:${x.dias.length ? 'none' : '1px solid #f3f4f6'};text-align:right">${fmtMoneda(x.app)}</td>
              <td style="padding:5px 8px;border-bottom:${x.dias.length ? 'none' : '1px solid #f3f4f6'};text-align:right">${fmtMoneda(x.xubio)}</td>
              <td style="padding:5px 8px;border-bottom:${x.dias.length ? 'none' : '1px solid #f3f4f6'};text-align:right;font-weight:700;color:${x.diferencia > 0 ? '#dc2626' : '#b45309'}">${x.diferencia > 0 ? '+' : '−'}${fmtMoneda(Math.abs(x.diferencia))}</td>
            </tr>
            ${x.dias.slice(0, 4).map((dia, i, arr) => {
              const ultimo = i === arr.length - 1 && x.dias.length <= 4;
              const borde = ultimo ? '1px solid #f3f4f6' : 'none';
              const nros = dia.comprobantes.map((n) => n.slice(-4)).join(', ');
              return `<tr style="color:#9ca3af;font-size:11.5px">
                <td style="padding:1px 8px 1px 20px;border-bottom:${borde}">${fmtDia(dia.fecha)}${nros ? ` · factura ${nros}` : ' · sin factura en Xubio'}</td>
                <td style="padding:1px 8px;border-bottom:${borde};text-align:right">${fmtMoneda(dia.app)}</td>
                <td style="padding:1px 8px;border-bottom:${borde};text-align:right">${fmtMoneda(dia.xubio)}</td>
                <td style="padding:1px 8px;border-bottom:${borde};text-align:right">${dia.diferencia > 0 ? '+' : '−'}${fmtMoneda(Math.abs(dia.diferencia))}</td>
              </tr>`;
            }).join('')}
            ${x.dias.length > 4 ? `<tr style="color:#9ca3af;font-size:11.5px"><td colspan="4" style="padding:1px 8px 1px 20px;border-bottom:1px solid #f3f4f6">y ${x.dias.length - 4} días más con diferencias</td></tr>` : ''}`).join('')}
        </table>`;

  // ── Cuánto se sigue haciendo fuera de la app ──
  //
  // Va al final y no arriba: es un indicador de proceso, no una tarea del mes. Pero va, y con
  // nombre y monto, porque sin esto "queremos depender menos de Xubio" es una intención sin
  // forma de saber si se está cumpliendo.
  const d2 = d.dependencia;
  const pctComp = d2.totalComprobantes > 0 ? Math.round((d2.comprobantesDeLaApp / d2.totalComprobantes) * 100) : null;
  const pctCob = d2.totalCobranzas > 0 ? Math.round((d2.cobranzasDeLaApp / d2.totalCobranzas) * 100) : null;
  const listaAjenos = (items: { numero: string; fecha: string; cliente: string; importe: number }[]) =>
    items.slice(0, 8).map((x) => `<li>${fmtDia(x.fecha)} · ${x.cliente || '(sin cliente)'} · ${x.numero || 'sin número'} — ${fmtMoneda(x.importe)}</li>`).join('')
    + (items.length > 8 ? `<li>y ${items.length - 8} más</li>` : '');

  const dependenciaHtml = (pctComp === null && pctCob === null) ? '' : `
    <h3 style="margin:20px 0 6px;font-size:14px">Cuánto se hizo fuera de la app</h3>
    <p style="margin:0 0 8px;font-size:11.5px;color:#9ca3af">
      Para que Xubio sea solo el lugar donde se emite, toda factura y todo cobro tienen que salir de la app.
      Lo que aparece acá es lo que se cargó directo en Xubio: eso la app no lo tiene, y es lo que obliga a
      seguir yendo a buscarlo allá.
    </p>
    ${pctComp === null ? '' : `<p style="margin:0 0 4px;font-size:13px">
      <strong>Facturas:</strong> ${d2.comprobantesDeLaApp} de ${d2.totalComprobantes} se emitieron desde la app
      <span style="color:${pctComp === 100 ? '#059669' : '#b45309'};font-weight:700">(${pctComp}%)</span>
    </p>`}
    ${d2.comprobantesAjenos.length ? `<ul style="margin:0 0 10px;padding-left:18px;font-size:12px;color:#6b7280">${listaAjenos(d2.comprobantesAjenos)}</ul>` : ''}
    ${pctCob === null ? '' : `<p style="margin:0 0 4px;font-size:13px">
      <strong>Cobranzas:</strong> ${d2.cobranzasDeLaApp} de ${d2.totalCobranzas} se registraron desde la app
      <span style="color:${pctCob === 100 ? '#059669' : '#b45309'};font-weight:700">(${pctCob}%)</span>
    </p>`}
    ${d2.cobranzasAjenas.length ? `<ul style="margin:0;padding-left:18px;font-size:12px;color:#6b7280">${listaAjenos(d2.cobranzasAjenas)}</ul>` : ''}`;

  return `
  <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:720px">
    <h2 style="margin:0 0 2px;font-size:18px">Control de facturación</h2>
    <p style="margin:0 0 16px;font-size:12px;color:#9ca3af">Del ${fmtDia(d.desde)} al ${fmtDia(d.hasta)} · Xavia</p>

    <h3 style="margin:0 0 6px;font-size:14px">Ventas sin facturar</h3>
    <p style="margin:0 0 8px;font-size:11.5px;color:#9ca3af">Mercadería que salió y todavía no tiene factura. Mientras no se facture no se puede cobrar.</p>
    ${pendientesHtml}

    <h3 style="margin:20px 0 6px;font-size:14px">App vs. Xubio</h3>
    <p style="margin:0 0 8px;font-size:11.5px;color:#9ca3af">
      ${c.disponible ? `${fmtMoneda(c.totalApp)} según la app, ${fmtMoneda(c.totalXubio)} en Xubio. ` : ''}
      Solo diferencias de más de ${fmtMoneda(DIF_MINIMA_PESOS)}. Ya está contemplado el IVA de la factura A
      y que una entrega se facture al día siguiente: lo que aparece acá es diferencia de verdad.
    </p>
    ${difHtml}

    ${dependenciaHtml}

    <p style="margin:18px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">
      En positivo: la app dice que se vendió más de lo que está facturado en Xubio. En negativo: en Xubio hay más
      de lo que la app registró como vendido (puede ser una factura cargada a mano allá).
    </p>
  </div>`;
}

export function construirTextoFacturacion(d: DatosInformeFacturacion): string {
  const L: string[] = [`*Control de facturación* — ${fmtDia(d.desde)} al ${fmtDia(d.hasta)}`, ''];
  L.push('*Ventas sin facturar*');
  if (!d.control.pendientes.length) L.push('  ✓ No quedó nada sin facturar.');
  for (const p of d.control.pendientes) {
    L.push(`  ${p.cliente}: ${p.unidades.toLocaleString('es-AR')} u · ${fmtMoneda(p.monto)} · desde ${fmtDia(p.diaMasViejo)} (${p.atraso} días)`);
  }
  L.push('', '*App vs Xubio*');
  if (!d.comparacion.disponible) L.push('  No se pudo leer Xubio.');
  else if (!d.comparacion.porCliente.length) L.push(`  ✓ Ningún cliente con diferencias de más de ${fmtMoneda(DIF_MINIMA_PESOS)}.`);
  for (const x of d.comparacion.porCliente) {
    L.push(`  ${x.cliente}: app ${fmtMoneda(x.app)} vs Xubio ${fmtMoneda(x.xubio)} — ${x.diferencia > 0 ? '+' : '−'}${fmtMoneda(Math.abs(x.diferencia))}`);
    for (const dia of x.dias.slice(0, 4)) {
      const nros = dia.comprobantes.map((n) => n.slice(-4)).join(', ');
      L.push(`      ${fmtDia(dia.fecha)}: ${dia.diferencia > 0 ? '+' : '−'}${fmtMoneda(Math.abs(dia.diferencia))}${nros ? ` (factura ${nros})` : ' (sin factura en Xubio)'}`);
    }
  }
  const d2 = d.dependencia;
  if (d2.totalComprobantes > 0 || d2.totalCobranzas > 0) {
    L.push('', '*Cuánto se hizo fuera de la app*');
    if (d2.totalComprobantes > 0) L.push(`  Facturas: ${d2.comprobantesDeLaApp}/${d2.totalComprobantes} desde la app`);
    if (d2.totalCobranzas > 0) L.push(`  Cobranzas: ${d2.cobranzasDeLaApp}/${d2.totalCobranzas} desde la app`);
  }
  return L.join('\n');
}

export async function enviarInformeFacturacion(): Promise<{ ok: boolean; error?: string; diferencias?: number; pendientes?: number }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' };
  try {
    const datos = await obtenerDatosInformeFacturacion();
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: ['administracion@xavia.com.ar'],
        subject: `Control de facturación — Xavia — ${datos.hasta}`,
        html: construirHtmlFacturacion(datos),
        text: construirTextoFacturacion(datos),
      }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); return { ok: false, error: (err as any).message || `HTTP ${res.status}` }; }
    return {
      ok: true,
      diferencias: datos.comparacion.porCliente.length,
      pendientes: datos.control.pendientes.length,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error al generar el informe' };
  }
}
