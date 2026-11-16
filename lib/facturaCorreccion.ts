// ── Cuando la corrección SUMA, va otra factura ───────────────────────────────────────
//
// Corregir una venta ya facturada puede ir para los dos lados. Si baja, se emite una nota
// de crédito (ver lib/notaCredito.ts). Si sube, hasta acá no se emitía nada: quedaba un
// ajuste diciendo "esta factura hay que cobrarla por más", el comprobante seguía por el
// importe viejo, y la diferencia vivía en una hoja de la app sin respaldo fiscal.
//
// Lo formal sería una nota de débito. Decisión de Marcos: una factura nueva por la
// diferencia, no una ND. Tiene sentido práctico — es mercadería que se entregó y no estaba
// facturada, así que facturarla es exactamente lo que pasó — y además entra sola a todo lo
// que ya funciona: aparece en los comprobantes de Xubio como una factura más, suma a la
// deuda del cliente, entra en el reclamo del lunes y en el control de facturación. Una ND
// no la mira ninguno de esos caminos.
//
// Por eso tampoco se anota ajuste cuando esto sale bien: la factura original queda como
// está y la diferencia la explica el comprobante nuevo. Anotar las dos cosas sumaría la
// diferencia dos veces.

import { appendRowObj, asegurarHoja, readSheet, updateRow } from './sheets';
import { emitirFactura, getClientesXubio, matchClienteXubio, PRODUCTO_CODIGO } from './xubio';
import { precioFinal } from './estadisticasVentas';
import { claveComprobante } from './comprobantes';
import { HOJA_AJUSTES, type AjusteFactura } from './ajusteFactura';
import { fechaArgentinaHoy } from './ocupacion';
import { leerArticulosExtra } from './articulosVenta';
import type { VentaDia, PrecioVenta, ClienteVenta } from './types';

export const HOJA_FACT_CORRECCION = 'FacturasPorCorreccion';
export const HEADERS_FACT_CORRECCION = [
  'numero_nuevo', 'numero_original', 'id_control', 'cliente', 'fecha', 'importe',
  'cae', 'transaccionid', 'detalle', 'usuario', 'fecha_carga', 'estado', 'avisado',
];

export interface FacturaPorCorreccion {
  numero_nuevo: string;
  numero_original: string;
  id_control: string;
  cliente: string;
  fecha: string;
  importe: number | string;
  cae: string;
  transaccionid: number | string;
  detalle: string;
  usuario: string;
  fecha_carga: string;
  estado: string;
  avisado?: string;
}

export interface LineaAlta {
  id_venta: string;
  key: string;
  cantidad: number;   // cuánto se agregó
}

export interface ResultadoFacturaCorreccion {
  ok: boolean;
  numero?: string;
  cae?: string;
  importe?: number;
  error?: string;
}

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };

export async function emitirFacturaPorCorreccion(args: {
  // La factura que se corrigió. No se toca: sirve para saber la letra y para dejar dicho
  // de dónde viene la nueva.
  numeroOriginal: string;
  altas: LineaAlta[];
  usuario: string;
}): Promise<ResultadoFacturaCorreccion> {
  const numeroOriginal = String(args.numeroOriginal || '').trim();
  if (!numeroOriginal) return { ok: false, error: 'Falta el número de la factura original.' };
  const altas = (args.altas || []).filter((l) => num(l.cantidad) > 0);
  if (!altas.length) return { ok: false, error: 'No hay nada para facturar.' };

  const [ventas, precios, clientes, extra] = await Promise.all([
    readSheet<VentaDia>('Ventas'),
    readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
    readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
    leerArticulosExtra().catch(() => []),
  ]);

  // El producto de Xubio de cada clave, incluidos los dados de alta desde Admin: sin esto,
  // una corrección que agrega berro no se podría facturar y el error sería "no existe".
  const codigoDe: Record<string, string> = { ...(PRODUCTO_CODIGO as any) };
  for (const a of extra) if (a.key) codigoDe[a.key] = String((a as any).xubio || '');

  const porVenta = new Map<string, VentaDia>();
  for (const l of altas) {
    const v = ventas.find((x) => String(x.id_venta) === String(l.id_venta));
    if (!v) return { ok: false, error: `No se encontró la venta ${l.id_venta}.` };
    if (claveComprobante(v.exportado) !== claveComprobante(numeroOriginal)) {
      return { ok: false, error: `La venta ${l.id_venta} no pertenece a la factura ${numeroOriginal}.` };
    }
    porVenta.set(String(v.id_venta), v);
  }

  const primera = porVenta.values().next().value as VentaDia | undefined;
  if (!primera) return { ok: false, error: 'No se encontraron las ventas de esa factura.' };
  const cli = clientes.find((c) => String(c.id_control) === String(primera.id_control));
  if (!cli) return { ok: false, error: 'No se encontró el cliente de esa factura.' };

  // La letra sale de la factura original, no de la ficha: la corrección de una A tiene que
  // salir por el mismo punto de venta que la A.
  const esA = /^A/i.test(numeroOriginal);

  const items: { codigo: string; cantidad: number; precio: number; descripcion?: string }[] = [];
  let importe = 0;
  for (const l of altas) {
    const v = porVenta.get(String(l.id_venta))!;
    const codigo = codigoDe[l.key];
    if (!codigo) return { ok: false, error: `El artículo ${l.key} no tiene producto equivalente en Xubio.` };
    const precio = precioFinal(precios, String(v.id_control), v.sucursal, l.key, cli);
    if (!(precio > 0)) return { ok: false, error: `No hay precio cargado de ${l.key} para ${cli.nombre_display || cli.nombre_xubio}.` };
    const cant = num(l.cantidad);
    // La descripción dice de qué factura viene: en la grilla de Xubio, una factura suelta
    // por una diferencia chica es imposible de ubicar sin eso.
    const desc = `${v.sucursal ? `${v.sucursal} — ` : ''}ajuste de ${numeroOriginal}`;
    const ya = items.find((x) => x.codigo === codigo && x.precio === precio && x.descripcion === desc);
    if (ya) ya.cantidad += cant;
    else items.push({ codigo, cantidad: cant, precio, descripcion: desc });
    importe += cant * precio;
  }

  const clientesXubio = await getClientesXubio().catch(() => []);
  const clienteId = matchClienteXubio(String(cli.nombre_xubio || cli.nombre_display), clientesXubio);
  if (!clienteId) return { ok: false, error: `No se encontró "${cli.nombre_xubio}" en los clientes de Xubio.` };

  const hoy = fechaArgentinaHoy();
  const r = await emitirFactura({ clienteId, esA, fecha: hoy, items });
  if (!r.ok) return { ok: false, error: r.error || 'Xubio rechazó la factura.' };

  await asegurarHoja(HOJA_FACT_CORRECCION, HEADERS_FACT_CORRECCION);
  await appendRowObj(HOJA_FACT_CORRECCION, {
    numero_nuevo: r.numeroDocumento || '',
    numero_original: numeroOriginal,
    id_control: String(cli.id_control),
    cliente: String(cli.nombre_display || cli.nombre_xubio || ''),
    fecha: hoy,
    importe: Math.round(importe),
    cae: r.cae || '',
    transaccionid: r.transaccionid || '',
    detalle: items.map((i) => `${i.cantidad} ${i.codigo}`).join(' · '),
    usuario: args.usuario,
    fecha_carga: new Date().toISOString(),
    estado: 'emitida',
    avisado: '',
  });

  // Se anula el ajuste de esa factura, si lo había: la diferencia ya está facturada aparte
  // y dejarlo la sumaría dos veces. Misma regla que con la nota de crédito.
  const ajustes = await readSheet<AjusteFactura>(HOJA_AJUSTES).catch(() => []);
  const tiene = ajustes.some((a) => claveComprobante(a.numero) === claveComprobante(numeroOriginal) && String(a.estado) !== 'revertido');
  if (tiene) {
    await updateRow(HOJA_AJUSTES, 'numero', numeroOriginal, {
      estado: 'revertido',
      motivo: `La diferencia se facturó aparte en ${r.numeroDocumento || ''}`,
      usuario: args.usuario,
    }).catch(() => false);
  }

  return { ok: true, numero: r.numeroDocumento, cae: r.cae, importe: Math.round(importe) };
}
