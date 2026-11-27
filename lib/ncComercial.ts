// ── Emitir una nota de crédito por un importe acordado ───────────────────────────────
//
// El caso: La Gallega reclama un 20% sobre una factura por un acuerdo comercial. Las
// cantidades están bien —se entregó lo que dice— y aun así hay que acreditarle plata.
//
// La NC que ya existía sale de corregir CANTIDADES. Para esto no sirve: habría que
// inventar que se entregó de menos, y la factura pasaría a decir algo que no pasó.
//
// Esta emite por importe. Las líneas se arman con los MISMOS artículos de la factura, las
// mismas cantidades y el precio proporcional (ver lib/ncPorImporte.ts): no hace falta crear
// un producto "descuento" en Xubio, y el IVA sale sobre los mismos artículos.
//
// ── Lo que NO hace, a propósito ──
//
// No toca las filas de Ventas. Las cantidades entregadas no cambiaron: cambió lo que se
// cobra. Restarlas haría que el stock, el rendimiento de los lotes y las estadísticas de
// venta digan que salió menos mercadería de la que salió.

import { appendRowObj, asegurarHoja, readSheet, updateRow } from './sheets';
import { emitirNotaCredito, getClientesXubio, matchClienteXubio } from './xubio';
import { precioFinal } from './estadisticasVentas';
import { PRODUCTO_XUBIO } from './articulos';
import { claveComprobante } from './comprobantes';
import { fechaArgentinaHoy } from './ocupacion';
import { HOJA_AJUSTES, type AjusteFactura } from './ajusteFactura';
import { HOJA_NOTAS, HEADERS_NOTAS, avisarNotaCredito, type ResultadoNC } from './notaCredito';
import { lineasParaCredito, totalDe, type LineaFactura } from './ncPorImporte';
import { clavesDeVenta } from './clavesVenta';
import type { VentaDia, PrecioVenta, ClienteVenta } from './types';

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };

// Las líneas reales de una factura: cada artículo con cantidad > 0 de cada venta, al
// precio del cliente. Es la base del prorrateo, y sale del MISMO `precioFinal` que usa la
// facturación: si acá se valorizara distinto, la NC no sería un porcentaje de la factura.
export async function lineasDeFactura(numeroFactura: string): Promise<{
  ok: boolean; error?: string;
  lineas: LineaFactura[]; total: number;
  cliente?: ClienteVenta; esA?: boolean;
}> {
  const numero = String(numeroFactura || '').trim();
  if (!numero) return { ok: false, error: 'Falta el número de factura.', lineas: [], total: 0 };

  const [ventas, precios, clientes, claves] = await Promise.all([
    readSheet<VentaDia>('Ventas'),
    readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
    readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
    clavesDeVenta(),
  ]);

  const filas = ventas.filter((v) => claveComprobante(v.exportado) === claveComprobante(numero));
  if (!filas.length) {
    return {
      ok: false, lineas: [], total: 0,
      error: 'Esa factura no tiene ventas cargadas en la app, así que no hay líneas para prorratear. '
        + 'Puede haberse cargado directo en Xubio. La nota de crédito habría que hacerla allá.',
    };
  }

  const cli = clientes.find((c) => String(c.id_control) === String(filas[0].id_control));
  if (!cli) return { ok: false, error: 'No se encontró el cliente de esa factura.', lineas: [], total: 0 };

  const lineas: LineaFactura[] = [];
  for (const v of filas) {
    for (const k of claves) {
      const cant = num((v as any)[k]);
      if (cant <= 0) continue;
      const precio = precioFinal(precios, String(v.id_control), v.sucursal, k, cli);
      if (!(precio > 0)) continue;
      lineas.push({ id_venta: String(v.id_venta), key: k, sucursal: String(v.sucursal || ''), cantidad: cant, precio });
    }
  }
  if (!lineas.length) {
    return { ok: false, error: 'La factura no tiene ninguna línea con cantidad y precio.', lineas: [], total: 0 };
  }

  return { ok: true, lineas, total: totalDe(lineas), cliente: cli, esA: /^A/i.test(numero) };
}

export async function emitirNCPorImporte(args: {
  numeroFactura: string;
  // Lo que hay que acreditar. Uno de los dos: el importe final que tiene que quedar, o el
  // monto a acreditar. Se pide uno y se calcula el otro, para que no puedan contradecirse.
  importeFinal?: number;
  importeACreditar?: number;
  motivo: string;
  usuario: string;
}): Promise<ResultadoNC & { porcentaje?: number; importeOriginal?: number }> {
  const numeroFactura = String(args.numeroFactura || '').trim();
  const motivo = String(args.motivo || '').trim();
  // El motivo es obligatorio. Una NC sin explicación es plata que salió y que en tres meses
  // nadie va a poder justificar ante el cliente ni ante el contador.
  if (!motivo) return { ok: false, error: 'Escribí por qué se emite la nota de crédito.' };

  const base = await lineasDeFactura(numeroFactura);
  if (!base.ok || !base.cliente) return { ok: false, error: base.error || 'No se pudo leer la factura.' };

  const aCreditar = args.importeACreditar !== undefined
    ? Math.round((Number(args.importeACreditar) || 0) * 100) / 100
    : Math.round(((base.total) - (Number(args.importeFinal) || 0)) * 100) / 100;

  if (aCreditar <= 0) {
    return {
      ok: false,
      error: `El importe nuevo tiene que ser MENOR que el de la factura ($${Math.round(base.total).toLocaleString('es-AR')}). `
        + 'Una nota de crédito solo puede bajar lo que se cobra; si hay que cobrar más, va otra factura.',
    };
  }

  const rep = lineasParaCredito(base.lineas, aCreditar);
  if (!rep.ok) return { ok: false, error: rep.error };

  const items: { codigo: string; cantidad: number; precio: number; descripcion?: string }[] = [];
  for (const l of rep.lineas) {
    const codigo = (PRODUCTO_XUBIO as any)[l.key];
    if (!codigo) return { ok: false, error: `El artículo ${l.key} no tiene producto equivalente en Xubio.` };
    // Se juntan las líneas del mismo artículo al mismo precio: una NC con el mismo producto
    // repetido cinco veces por sucursal es ilegible al lado de su factura.
    const ya = items.find((x) => x.codigo === codigo && x.precio === l.precio);
    if (ya) ya.cantidad += l.cantidad;
    else items.push({ codigo, cantidad: l.cantidad, precio: l.precio, descripcion: l.sucursal || '' });
  }

  const clientesXubio = await getClientesXubio().catch(() => []);
  const clienteId = matchClienteXubio(String(base.cliente.nombre_xubio || base.cliente.nombre_display), clientesXubio);
  if (!clienteId) return { ok: false, error: `No se encontró "${base.cliente.nombre_xubio}" en los clientes de Xubio.` };

  const hoy = fechaArgentinaHoy();
  const r = await emitirNotaCredito({ clienteId, esA: !!base.esA, fecha: hoy, items, facturaOriginal: numeroFactura });
  if (!r.ok) return { ok: false, error: r.error || 'Xubio rechazó la nota de crédito.' };

  await asegurarHoja(HOJA_NOTAS, HEADERS_NOTAS);
  await appendRowObj(HOJA_NOTAS, {
    numero_nc: r.numeroDocumento || '',
    numero_factura: numeroFactura,
    id_control: String(base.cliente.id_control),
    cliente: String(base.cliente.nombre_display || base.cliente.nombre_xubio || ''),
    fecha: hoy,
    importe: Math.round(rep.importe),
    cae: r.cae || '',
    transaccionid: r.transaccionid || '',
    detalle: `${rep.porcentaje}% de la factura — ${motivo}`,
    usuario: args.usuario,
    fecha_carga: new Date().toISOString(),
    estado: 'emitida',
  });

  // Igual que las otras dos NC: si había un ajuste a mano sobre esta factura se revierte.
  // Con la NC emitida la deuda ya bajó en Xubio, y dejar el ajuste la bajaría dos veces.
  const ajustes = await readSheet<AjusteFactura>(HOJA_AJUSTES).catch(() => []);
  const tiene = ajustes.some((a) => claveComprobante(a.numero) === claveComprobante(numeroFactura) && String(a.estado) !== 'revertido');
  if (tiene) {
    await updateRow(HOJA_AJUSTES, 'numero', numeroFactura, {
      estado: 'revertido',
      motivo: `Reemplazado por la nota de crédito ${r.numeroDocumento || ''} (por importe: ${motivo})`,
      usuario: args.usuario,
    }).catch(() => false);
  }

  await avisarNotaCredito({
    numeroNC: String(r.numeroDocumento || ''),
    numeroFactura,
    cliente: String(base.cliente.nombre_display || base.cliente.nombre_xubio || ''),
    importe: Math.round(rep.importe),
    detalle: `${rep.porcentaje}% de la factura`,
    automatica: false,
    sinAsociar: r.sinAsociar,
    motivo,
  });

  return {
    ok: true,
    numeroNC: r.numeroDocumento,
    cae: r.cae,
    importe: Math.round(rep.importe),
    porcentaje: rep.porcentaje,
    importeOriginal: Math.round(base.total),
  };
}
