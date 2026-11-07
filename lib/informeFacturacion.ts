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
import { compararFacturado, controlFacturacion, DIF_MINIMA_PESOS, DIAS_CORRIMIENTO, DIAS_MISMO_IMPORTE, type ComparacionFacturado, type ControlFacturacion } from './controlFacturacion';
import { comprobantesParaMirar } from './xubioLectura';
import { fechaArgentinaHoy } from './ocupacion';
import { compararPorComprobante, type ComparacionPorComprobante } from './controlFacturacion';
import { clavesDeArticulo } from './clavesVenta';
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
  // El control que de verdad sirve: cruza por NÚMERO de comprobante, no por fecha. El de
  // arriba queda como totales por cliente; el detalle por día se reemplazó, porque la
  // factura no sale siempre con la fecha de la venta y eso generaba diferencias falsas.
  porComprobante: ComparacionPorComprobante;
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
    porComprobante: compararPorComprobante(ventas, precios, clientes, comprobantes, desde, hasta, await clavesDeArticulo()),
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

  // ── Las diferencias, comprobante por comprobante ────────────────────────────────
  //
  // Antes esto se listaba por (cliente, día) y el informe era ilegible: la factura no sale
  // siempre con la fecha de la venta —AFIP exige numeración correlativa, así que la app
  // corre la fecha cuando hace falta— y cada venta facturada un día después producía DOS
  // renglones en rojo: "sin factura en Xubio" el día de la venta y plata de más el día de
  // la factura. Con el informe lleno de diferencias que no existían, las de verdad no se
  // veían.
  //
  // Ahora se cruza por el NÚMERO de comprobante, que la app guarda al emitir. El cruce es
  // exacto y no depende de ninguna fecha.
  const pc = d.porComprobante;
  const ETIQUETA_ESTADO: Record<string, { txt: string; color: string }> = {
    falta_en_xubio: { txt: 'la app la emitió y Xubio no la tiene', color: '#991b1b' },
    difiere:        { txt: 'importes distintos', color: '#b45309' },
    solo_en_xubio:  { txt: 'cargada a mano en Xubio', color: '#6b7280' },
  };
  const difHtml = !pc.disponible
    ? '<p style="margin:0;font-size:12px;color:#9ca3af">No se pudo leer Xubio para contrastar.</p>'
    : !pc.comprobantes.length
      ? `<p style="margin:0;font-size:13px;color:#059669">✓ Los ${pc.coinciden} comprobantes del período cierran con Xubio.</p>`
      : `<p style="margin:0 0 6px;font-size:12px;color:#6b7280">
           ${pc.coinciden} comprobante(s) cierran. Estos ${pc.comprobantes.length} no:
         </p>
         <table style="border-collapse:collapse;width:100%;font-size:12.5px">
          <thead><tr style="background:#f9fafb;color:#6b7280">
            <th style="padding:5px 8px;text-align:left">Comprobante</th>
            <th style="padding:5px 8px;text-align:left">Cliente</th>
            <th style="padding:5px 8px;text-align:right">Según la app</th>
            <th style="padding:5px 8px;text-align:right">En Xubio</th>
            <th style="padding:5px 8px;text-align:right">Diferencia</th>
          </tr></thead>
          <tbody>${pc.comprobantes.slice(0, 25).map((x) => {
            const e = ETIQUETA_ESTADO[x.estado];
            return `<tr>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace;font-size:11.5px">
                ${x.numero}<br><span style="color:${e.color};font-family:inherit;font-size:10.5px">${e.txt}</span>
              </td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6">${x.cliente || '(sin cliente)'}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right">${x.app ? fmtMoneda(x.app) : '—'}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right">${x.xubio ? fmtMoneda(x.xubio) : '—'}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;color:${e.color}">${x.diferencia > 0 ? '+' : '−'}${fmtMoneda(Math.abs(x.diferencia))}</td>
            </tr>`;
          }).join('')}
          ${pc.comprobantes.length > 25 ? `<tr><td colspan="5" style="padding:4px 8px;color:#9ca3af;font-size:11.5px">y ${pc.comprobantes.length - 25} más</td></tr>` : ''}
          </tbody>
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
      Solo diferencias de más de ${fmtMoneda(DIF_MINIMA_PESOS)}. Antes de listar nada se descuenta el ruido de fechas:
      el IVA de la factura A, lo entregado un día y facturado hasta ${DIAS_CORRIMIENTO} días después, y los días que
      coinciden AL PESO con otro día del mismo cliente dentro de los ${DIAS_MISMO_IMPORTE} días (esa es la misma venta
      facturada en otra fecha, no una diferencia). Lo que aparece acá es diferencia de verdad.
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
  // Mismo criterio que el HTML: por número de comprobante. Las dos versiones del mismo
  // informe no pueden listar cosas distintas.
  L.push('', '*App vs Xubio — por comprobante*');
  const pcT = d.porComprobante;
  const MOTIVO: Record<string, string> = {
    falta_en_xubio: 'la app la emitió y Xubio no la tiene',
    difiere: 'importes distintos',
    solo_en_xubio: 'cargada a mano en Xubio',
  };
  if (!pcT.disponible) L.push('  No se pudo leer Xubio.');
  else if (!pcT.comprobantes.length) L.push(`  ✓ Los ${pcT.coinciden} comprobantes del período cierran.`);
  else {
    L.push(`  ${pcT.coinciden} cierran. Estos ${pcT.comprobantes.length} no:`);
    for (const x of pcT.comprobantes.slice(0, 20)) {
      L.push(`  ${x.numero} · ${x.cliente || '(sin cliente)'} — ${MOTIVO[x.estado]}`);
      L.push(`      app ${x.app ? fmtMoneda(x.app) : '—'} vs Xubio ${x.xubio ? fmtMoneda(x.xubio) : '—'} (${x.diferencia > 0 ? '+' : '−'}${fmtMoneda(Math.abs(x.diferencia))})`);
    }
    if (pcT.comprobantes.length > 20) L.push(`  y ${pcT.comprobantes.length - 20} más`);
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
