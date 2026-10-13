import { appendRowObj, asegurarHoja, readSheet, updateRow, batchUpdateRows } from './sheets';
import { emitirNotaCredito, getClientesXubio, matchClienteXubio } from './xubio';
import { precioFinal } from './estadisticasVentas';
import { PRODUCTO_XUBIO } from './articulos';
import { claveComprobante } from './comprobantes';
import { HOJA_AJUSTES, type AjusteFactura } from './ajusteFactura';
import { fechaArgentinaHoy } from './ocupacion';
import type { VentaDia, PrecioVenta, ClienteVenta } from './types';

// ── Notas de crédito emitidas desde la app ────────────────────────────────────────────
//
// Hay dos formas de corregir una factura ya emitida y son excluyentes:
//
//   · NOTA DE CRÉDITO — se emite el comprobante en Xubio. Es la corrección formal: el cliente
//     recibe la NC, AFIP la ve, y la deuda baja de los dos lados.
//   · CORREGIR SIN XUBIO — se anota un ajuste y solo cambia lo que la app reclama (ver
//     ajusteFactura.ts). La factura sigue diciendo lo que dice.
//
// Que sean excluyentes no es un detalle de la interfaz: si se hicieran las dos sobre la misma
// factura, la deuda bajaría DOS VECES —una por la NC que entra a Xubio, otra por el ajuste que
// la app aplica encima— y el cliente quedaría figurando como que debe de menos. Ese error es
// silencioso y aparece meses después, cuando ya nadie se acuerda. Por eso emitir la NC anula
// el ajuste de esa factura, acá adentro y no en la pantalla.

export const HOJA_NOTAS = 'NotasCredito';
export const HEADERS_NOTAS = [
  'numero_nc', 'numero_factura', 'id_control', 'cliente', 'fecha', 'importe',
  'cae', 'transaccionid', 'detalle', 'usuario', 'fecha_carga', 'estado',
];

export interface NotaCreditoRegistrada {
  numero_nc: string;
  numero_factura: string;
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
}

export interface LineaNC {
  id_venta: string;
  key: string;      // clave de artículo (rucula, lechuga_crespa, …)
  cantidad: number; // cuánto se acredita
}

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };

export async function leerNotas(): Promise<NotaCreditoRegistrada[]> {
  return readSheet<NotaCreditoRegistrada>(HOJA_NOTAS).catch(() => []);
}

// Las facturas que ya tienen una NC emitida desde la app, por clave de comprobante. Sirve
// para no ofrecer dos veces lo mismo y para mostrarlo en el historial.
export function facturasConNota(filas: NotaCreditoRegistrada[]): Map<string, NotaCreditoRegistrada> {
  const m = new Map<string, NotaCreditoRegistrada>();
  for (const f of filas || []) {
    if (String(f.estado) === 'anulada') continue;
    const k = claveComprobante(f.numero_factura);
    if (k && !m.has(k)) m.set(k, f);
  }
  return m;
}

export interface ResultadoNC {
  ok: boolean;
  numeroNC?: string;
  cae?: string;
  importe?: number;
  error?: string;
}

export async function emitirNCDeFactura(args: {
  numeroFactura: string;
  lineas: LineaNC[];
  usuario: string;
}): Promise<ResultadoNC> {
  const numeroFactura = String(args.numeroFactura || '').trim();
  if (!numeroFactura) return { ok: false, error: 'Falta el número de factura.' };
  const lineas = (args.lineas || []).filter((l) => num(l.cantidad) > 0);
  if (!lineas.length) return { ok: false, error: 'No hay ninguna cantidad para acreditar.' };

  const [ventas, precios, clientes] = await Promise.all([
    readSheet<VentaDia>('Ventas'),
    readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
    readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
  ]);

  // Las filas de venta que la NC toca, y la validación de que lo que se quiere acreditar
  // existe: no se puede acreditar más de lo que se facturó.
  const porVenta = new Map<string, VentaDia>();
  for (const l of lineas) {
    const v = ventas.find((x) => String(x.id_venta) === String(l.id_venta));
    if (!v) return { ok: false, error: `No se encontró la venta ${l.id_venta}.` };
    if (claveComprobante(v.exportado) !== claveComprobante(numeroFactura)) {
      return { ok: false, error: `La venta ${l.id_venta} no pertenece a la factura ${numeroFactura}.` };
    }
    const actual = num((v as any)[l.key]);
    if (num(l.cantidad) > actual + 0.0001) {
      return { ok: false, error: `No se puede acreditar ${l.cantidad} de ${l.key}: la factura tiene ${actual}.` };
    }
    porVenta.set(String(v.id_venta), v);
  }

  const primera = porVenta.values().next().value as VentaDia | undefined;
  if (!primera) return { ok: false, error: 'No se encontraron las ventas de esa factura.' };
  const cli = clientes.find((c) => String(c.id_control) === String(primera.id_control));
  if (!cli) return { ok: false, error: 'No se encontró el cliente de esa factura.' };

  // El punto de venta sale de la letra de la factura original: una NC de una factura A tiene
  // que salir por el PV electrónico, y una de una B por el otro. Deducirlo de la ficha del
  // cliente sería arriesgar que la NC salga con otra letra que la factura que corrige.
  const esA = /^A/i.test(numeroFactura.trim());

  // Las líneas de la NC, valorizadas con el MISMO precio que la factura: el de ese cliente y
  // esa sucursal. Si se usara otro, la NC no cancelaría lo que se facturó.
  const items: { codigo: string; cantidad: number; precio: number; descripcion?: string }[] = [];
  let importe = 0;
  for (const l of lineas) {
    const v = porVenta.get(String(l.id_venta))!;
    const codigo = (PRODUCTO_XUBIO as any)[l.key];
    if (!codigo) return { ok: false, error: `El artículo ${l.key} no tiene producto equivalente en Xubio.` };
    const precio = precioFinal(precios, String(v.id_control), v.sucursal, l.key, cli);
    if (!(precio > 0)) return { ok: false, error: `No hay precio cargado de ${l.key} para ${cli.nombre_display || cli.nombre_xubio}.` };
    const cant = num(l.cantidad);
    const ya = items.find((x) => x.codigo === codigo && x.precio === precio);
    if (ya) ya.cantidad += cant;
    else items.push({ codigo, cantidad: cant, precio, descripcion: v.sucursal ? String(v.sucursal) : '' });
    importe += cant * precio;
  }

  const clientesXubio = await getClientesXubio().catch(() => []);
  const clienteId = matchClienteXubio(String(cli.nombre_xubio || cli.nombre_display), clientesXubio);
  if (!clienteId) return { ok: false, error: `No se encontró "${cli.nombre_xubio}" en los clientes de Xubio.` };

  const hoy = fechaArgentinaHoy();
  const r = await emitirNotaCredito({ clienteId, esA, fecha: hoy, items, facturaOriginal: numeroFactura });
  if (!r.ok) return { ok: false, error: r.error || 'Xubio rechazó la nota de crédito.' };

  // ── Recién con la NC emitida se toca lo nuestro ────────────────────────────────────
  //
  // En este orden a propósito, el mismo que usa el registro de cobros: si Xubio falla, no
  // queda una venta corregida contra una NC que no existe. Si falla lo de abajo, la NC está
  // emitida y se ve en Xubio, que es muchísimo menos malo que al revés.
  const updates: { keyValue: string; updates: Record<string, any> }[] = [];
  for (const [idVenta, v] of porVenta) {
    const cambios: Record<string, any> = {};
    for (const l of lineas.filter((x) => String(x.id_venta) === idVenta)) {
      cambios[l.key] = Math.max(0, num((v as any)[l.key]) - num(l.cantidad));
    }
    updates.push({ keyValue: idVenta, updates: cambios });
  }
  if (updates.length) await batchUpdateRows('Ventas', 'id_venta', updates);

  await asegurarHoja(HOJA_NOTAS, HEADERS_NOTAS);
  await appendRowObj(HOJA_NOTAS, {
    numero_nc: r.numeroDocumento || '',
    numero_factura: numeroFactura,
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
  });

  // Y se anula el ajuste de esa factura, si lo había. Las dos correcciones son excluyentes:
  // con la NC emitida, la deuda ya bajó en Xubio, y dejar el ajuste la bajaría de nuevo.
  const ajustes = await readSheet<AjusteFactura>(HOJA_AJUSTES).catch(() => []);
  const tiene = ajustes.some((a) => claveComprobante(a.numero) === claveComprobante(numeroFactura) && String(a.estado) !== 'revertido');
  if (tiene) {
    await updateRow(HOJA_AJUSTES, 'numero', numeroFactura, {
      estado: 'revertido',
      motivo: `Reemplazado por la nota de crédito ${r.numeroDocumento || ''}`,
      usuario: args.usuario,
    }).catch(() => false);
  }

  return { ok: true, numeroNC: r.numeroDocumento, cae: r.cae, importe: Math.round(importe) };
}
