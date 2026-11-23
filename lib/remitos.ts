// ── Remitos a partir de lo facturado ─────────────────────────────────────────────────
//
// Un remito es el papel de la entrega: qué se entregó y cuánto. Acá sale DESPUÉS de
// facturar (decisión de Marcos), así que la fuente es la factura ya emitida y no la carga
// del día: lo que dice el remito es exactamente lo que se facturó, sin posibilidad de que
// digan cosas distintas.
//
// ── Qué NO lleva ──
//
// Precios. Un remito documenta la entrega, no el cobro, y el importe ya está en la factura
// que lo acompaña. Ponerlo abriría la puerta a que el remito y la factura discrepen por un
// ajuste posterior, y entonces el cliente tiene dos papeles nuestros que no coinciden.
//
// Lo que sí lleva es el número de la factura, para que los dos papeles se puedan atar.

import { claveComprobante } from './comprobantes';
import type { VentaDia, ClienteVenta } from './types';

export interface LineaRemito {
  articulo: string;   // la etiqueta que se lee, no la clave
  cantidad: number;
  unidad: string;     // 'u' o 'kg'
}

export interface Remito {
  numeroFactura: string;
  fecha: string;          // la de la entrega (la venta)
  idControl: string;
  cliente: string;
  // Las sucursales que entraron en esa factura. Un cliente de varias puede tener una sola
  // factura para todas, y el remito tiene que decir a cuál fue cada cosa.
  porSucursal: { sucursal: string; lineas: LineaRemito[] }[];
  // Para mandarlo: el general del cliente, y si no tiene, el de cobranzas.
  email: string;
  // De dónde salió el mail, para poder decirlo en pantalla: mandar el remito a la casilla
  // de cobranzas es aceptable, pero no es lo mismo y quien aprieta tiene que saberlo.
  emailDe: 'general' | 'cobranzas' | 'ninguno';
}

const soloDia = (v: any) => String(v || '').split(/[T ]/)[0];
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// El mail al que va el remito: el general del cliente, y si no tiene, el de cobranzas.
// Es al revés que los recordatorios de cobro, que arrancan por el de cobranzas — y está
// bien que sea al revés: un remito es operativo y va a quien recibe la mercadería; un
// reclamo de plata va a quien paga.
export function mailDelCliente(c: ClienteVenta | undefined): { email: string; de: Remito['emailDe'] } {
  const general = String((c as any)?.email || '').trim();
  if (general.includes('@')) return { email: general, de: 'general' };
  const cobranzas = String((c as any)?.email_cobranza || '').trim();
  if (cobranzas.includes('@')) return { email: cobranzas, de: 'cobranzas' };
  return { email: '', de: 'ninguno' };
}

export interface ArticuloRemito { key: string; label: string; unidad?: string }

// Las facturas emitidas en los últimos `dias`, con su detalle, listas para hacer el remito.
//
// Se agrupan por NÚMERO de comprobante y no por fecha: una factura es un remito, aunque
// adentro tenga varias sucursales o varios días de entrega.
export function remitosDeFacturas(args: {
  ventas: VentaDia[];
  clientes: ClienteVenta[];
  articulos: ArticuloRemito[];
  hoy: string;
  dias?: number;
}): Remito[] {
  const { ventas, clientes, articulos, hoy } = args;
  const dias = args.dias ?? 7;
  const desde = (() => {
    const d = new Date(`${hoy}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (dias - 1));
    return d.toISOString().slice(0, 10);
  })();

  const porCliente = new Map(clientes.map((c) => [String(c.id_control), c]));
  const etiqueta = new Map(articulos.map((a) => [a.key, a]));

  // numero → remito en construcción
  const mapa = new Map<string, Remito & { _suc: Map<string, Map<string, LineaRemito>> }>();

  for (const v of ventas) {
    const numero = String((v as any).exportado || '').trim();
    // Sin número no hay factura emitida: PENDIENTE es una venta mandada a facturar que
    // todavía no volvió, y hacerle el remito sería documentar una entrega sin comprobante.
    if (!numero || numero.toUpperCase() === 'PENDIENTE' || numero.toUpperCase() === 'FACTURADO') continue;
    const fecha = soloDia(v.fecha);
    if (!fecha || fecha < desde || fecha > hoy) continue;

    const clave = claveComprobante(numero);
    const cli = porCliente.get(String(v.id_control));
    const mail = mailDelCliente(cli);

    let r = mapa.get(clave);
    if (!r) {
      r = {
        numeroFactura: numero,
        fecha,
        idControl: String(v.id_control || ''),
        cliente: String(cli?.nombre_display || cli?.nombre_xubio || v.nombre_cliente || v.id_control || ''),
        porSucursal: [],
        email: mail.email,
        emailDe: mail.de,
        _suc: new Map(),
      };
      mapa.set(clave, r);
    }
    // La fecha del remito es la de la entrega más vieja de esa factura: es cuándo salió la
    // mercadería, que es lo que el remito documenta.
    if (fecha < r.fecha) r.fecha = fecha;

    const suc = String(v.sucursal || '').trim() || r.cliente;
    const lineas = r._suc.get(suc) || new Map<string, LineaRemito>();
    for (const a of articulos) {
      const cant = num((v as any)[a.key]);
      if (cant <= 0) continue;
      const prev = lineas.get(a.key);
      if (prev) prev.cantidad += cant;
      else lineas.set(a.key, { articulo: a.label, cantidad: cant, unidad: a.unidad || 'u' });
    }
    r._suc.set(suc, lineas);
  }

  const out: Remito[] = [];
  for (const r of mapa.values()) {
    const porSucursal = [...r._suc.entries()]
      .map(([sucursal, m]) => ({ sucursal, lineas: [...m.values()].filter((l) => l.cantidad > 0) }))
      .filter((x) => x.lineas.length > 0)
      .sort((a, b) => a.sucursal.localeCompare(b.sucursal));
    // Una factura sin ninguna línea con cantidad no tiene remito que hacer. Pasa cuando la
    // venta se corrigió a cero después de facturar: el comprobante existe, la entrega no.
    if (!porSucursal.length) continue;
    const { _suc, ...limpio } = r;
    out.push({ ...limpio, porSucursal });
  }

  // Lo más reciente primero: es lo que se está por mandar.
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.cliente.localeCompare(b.cliente));
}

// El total de bultos del remito, para el pie del papel: quien recibe cuenta bultos, no
// renglones, y sin ese número hay que sumarlo a mano para controlar la entrega.
export function totalDe(r: Remito): { unidades: number; kilos: number } {
  let unidades = 0, kilos = 0;
  for (const s of r.porSucursal) {
    for (const l of s.lineas) {
      if (l.unidad === 'kg') kilos += l.cantidad;
      else unidades += l.cantidad;
    }
  }
  return { unidades: Math.round(unidades), kilos: Math.round(kilos * 10) / 10 };
}
