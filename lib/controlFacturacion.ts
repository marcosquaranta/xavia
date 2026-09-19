// ── Control: ventas que no llegaron a la factura ─────────────────────────────────────
//
// Ventas que quedaron en PENDIENTE: están en la cola de facturación pero nadie apretó el
// botón, o fallaron al emitir (cliente que no matchea en Xubio, fecha rechazada, límite de
// Sheets). La mercadería salió y la plata no se facturó.
//
// Las ventas en borrador (exportado vacío) NO cuentan: en esta app toda venta nace así y
// pasa a la cola cuando se la manda a facturar, o sea que "borrador" es un estado normal y
// listarlo era puro ruido.
//
// Por eso esto va al reporte semanal: el viernes es el momento en que todavía se puede
// corregir la semana.

import type { VentaDia, PrecioVenta, ClienteVenta } from './types';
import { nombreClienteVisible } from './clientes';

const PROD_KEYS = [
  'rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca',
  'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble',
] as const;

// Desde cuántos días de atraso deja de ser "lo de hoy todavía sin facturar" y pasa a ser un
// problema. Dos días cubre el fin de semana sin gritar por algo normal.
export const DIAS_ATRASO_AVISO = 2;

export interface ClienteSinFacturar {
  id_control: string;
  cliente: string;
  ventas: number;        // filas de la hoja Ventas
  dias: number;          // días distintos
  diaMasViejo: string;   // YYYY-MM-DD
  atraso: number;        // días desde el más viejo
  unidades: number;
  monto: number;
}

export interface ControlFacturacion {
  pendientes: ClienteSinFacturar[];
  montoPendiente: number;
  atrasoMax: number;
  hayProblema: boolean;
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

function precioDe(precios: PrecioVenta[], idControl: string, sucursal: string, key: string, sucursalesCliente?: string): number {
  let row = precios.find(p => String(p.id_control) === String(idControl) && p.sucursal_obs === sucursal);
  if (!row && sucursalesCliente) {
    for (const s of sucursalesCliente.split('|').map(x => x.trim()).filter(Boolean)) {
      row = precios.find(p => String(p.id_control) === String(idControl) && p.sucursal_obs === s);
      if (row) break;
    }
  }
  if (!row) row = precios.find(p => String(p.id_control) === String(idControl));
  return row ? Number((row as any)[key] || 0) : 0;
}

function agrupar(
  filas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], hoy: string,
): ClienteSinFacturar[] {
  const mapa = new Map<string, ClienteSinFacturar & { fechas: Set<string> }>();
  for (const v of filas) {
    const id = String(v.id_control || '');
    if (!id) continue;
    const cliente = clientes.find(c => String(c.id_control) === id);
    if (!mapa.has(id)) {
      mapa.set(id, {
        id_control: id, cliente: nombreClienteVisible(cliente) || v.nombre_cliente || id,
        ventas: 0, dias: 0, diaMasViejo: '', atraso: 0, unidades: 0, monto: 0, fechas: new Set(),
      });
    }
    const g = mapa.get(id)!;
    const f = soloFecha(v.fecha);
    let tieneAlgo = false;
    for (const key of PROD_KEYS) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      tieneAlgo = true;
      g.unidades += qty;
      g.monto += qty * precioDe(precios, id, v.sucursal, key, cliente?.sucursales);
    }
    // Una fila sin ninguna cantidad no es una venta sin facturar, es una fila vacía: no
    // suma al control ni hace que un cliente aparezca en la lista por nada.
    if (!tieneAlgo) continue;
    g.ventas++;
    if (f) g.fechas.add(f);
    if (f && (!g.diaMasViejo || f < g.diaMasViejo)) g.diaMasViejo = f;
  }
  const dias = (desde: string) =>
    desde ? Math.round((new Date(hoy + 'T12:00:00').getTime() - new Date(desde + 'T12:00:00').getTime()) / 86400000) : 0;
  return [...mapa.values()]
    .filter(g => g.ventas > 0)
    .map(({ fechas, ...g }) => ({ ...g, dias: fechas.size, atraso: dias(g.diaMasViejo) }))
    .sort((a, b) => b.atraso - a.atraso || b.monto - a.monto);
}

export function controlFacturacion(
  ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], hoy: string,
): ControlFacturacion {
  const pendientes = agrupar(ventas.filter(v => v.exportado === 'PENDIENTE'), precios, clientes, hoy);
  const montoPendiente = pendientes.reduce((a, g) => a + g.monto, 0);
  const atrasoMax = Math.max(0, ...pendientes.map(g => g.atraso));
  return {
    pendientes, montoPendiente, atrasoMax,
    // Que hoy quede algo sin facturar es normal; que tenga días encima, no.
    hayProblema: atrasoMax >= DIAS_ATRASO_AVISO && pendientes.length > 0,
  };
}

// ── Contraste: lo facturado según la app vs. lo que hay en Xubio ─────────────────────
//
// La app sabe qué vendió y a qué precio; Xubio sabe qué comprobantes existen. Si los dos
// números no dan parecido, algo se perdió en el medio: una factura que no salió, una que
// salió dos veces, un precio distinto al de la lista, o una cargada a mano en Xubio que
// la app no conoce.
//
// Dos cosas que hay que tener en cuenta para leer esto sin asustarse:
//
//   · Las fechas no son la misma cosa. La app mide por fecha de ENTREGA y Xubio por fecha
//     del COMPROBANTE, que puede ser posterior (ver fechaDeFactura). En los bordes del
//     período siempre va a haber corrimiento.
//   · Las notas de crédito restan, como corresponde.
//
// Por eso no alcanza con el total: la comparación es POR CLIENTE, que es donde una
// diferencia se puede rastrear.

export interface DiferenciaCliente {
  cliente: string;
  app: number;      // valorizado por la app, de lo que ya está marcado como facturado
  xubio: number;    // comprobantes de Xubio (netos de notas de crédito)
  diferencia: number; // app − xubio
  pct: number | null;
}

export interface ComparacionFacturado {
  desde: string;
  hasta: string;
  totalApp: number;
  totalXubio: number;
  diferencia: number;
  pct: number | null;
  porCliente: DiferenciaCliente[]; // solo los que se despegan, de mayor a menor
  disponible: boolean;             // false = no se pudo leer Xubio
}

// Tolerancia: por debajo de esto no es un problema, es redondeo y corrimiento de fechas.
export const DIF_MINIMA_PESOS = 50_000;
export const DIF_MINIMA_PCT = 2;

const norm = (s: any) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

function nombreDeComprobante(c: any): string {
  const cl = c?.cliente;
  if (!cl) return '';
  return String(typeof cl === 'string' ? cl : (cl.nombre || cl.name || '')).trim();
}

export function compararFacturado(
  ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[],
  comprobantes: any[] | null, desde: string, hasta: string,
): ComparacionFacturado {
  const vacio: ComparacionFacturado = {
    desde, hasta, totalApp: 0, totalXubio: 0, diferencia: 0, pct: null, porCliente: [], disponible: false,
  };
  if (!comprobantes) return vacio;

  // Lado app: ventas del período que la app da por facturadas (tienen número de
  // comprobante en `exportado`). Las PENDIENTE no van: esas ya las cuenta el control de
  // arriba y contarlas acá las haría aparecer como "diferencia" dos veces.
  const porClienteApp = new Map<string, { nombre: string; monto: number }>();
  for (const v of ventas) {
    const f = soloFecha(v.fecha);
    if (!f || f < desde || f > hasta) continue;
    const exp = String(v.exportado || '').trim();
    if (!exp || exp === 'PENDIENTE') continue;
    const cliente = clientes.find(c => String(c.id_control) === String(v.id_control));
    const clave = norm(cliente?.nombre_xubio || v.nombre_cliente || v.id_control);
    if (!clave) continue;
    let monto = 0;
    for (const key of PROD_KEYS) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      monto += qty * precioDe(precios, String(v.id_control), v.sucursal, key, cliente?.sucursales);
    }
    if (monto <= 0) continue;
    const prev = porClienteApp.get(clave);
    if (prev) prev.monto += monto;
    else porClienteApp.set(clave, { nombre: nombreClienteVisible(cliente) || String(v.nombre_cliente || clave), monto });
  }

  // Lado Xubio: comprobantes del período, con las notas de crédito (tipo 3) en negativo.
  const porClienteXubio = new Map<string, { nombre: string; monto: number }>();
  for (const c of comprobantes) {
    const f = soloFecha(c?.fecha);
    if (!f || f < desde || f > hasta) continue;
    const nombre = nombreDeComprobante(c);
    const clave = norm(nombre);
    if (!clave) continue;
    const signo = Number(c?.tipo) === 3 ? -1 : 1;
    const monto = signo * (Number(c?.importetotal) || 0);
    const prev = porClienteXubio.get(clave);
    if (prev) prev.monto += monto;
    else porClienteXubio.set(clave, { nombre, monto });
  }

  const claves = new Set([...porClienteApp.keys(), ...porClienteXubio.keys()]);
  const porCliente: DiferenciaCliente[] = [];
  for (const k of claves) {
    const app = Math.round(porClienteApp.get(k)?.monto || 0);
    const xubio = Math.round(porClienteXubio.get(k)?.monto || 0);
    const diferencia = app - xubio;
    const base = Math.max(Math.abs(app), Math.abs(xubio));
    const pct = base > 0 ? Math.round((diferencia / base) * 1000) / 10 : null;
    // Se listan solo las que importan: en plata Y en proporción. Una diferencia de
    // $60.000 sobre $8.000.000 es corrimiento de fechas, no un problema.
    if (Math.abs(diferencia) < DIF_MINIMA_PESOS) continue;
    if (pct !== null && Math.abs(pct) < DIF_MINIMA_PCT) continue;
    porCliente.push({
      cliente: porClienteApp.get(k)?.nombre || porClienteXubio.get(k)?.nombre || k,
      app, xubio, diferencia, pct,
    });
  }
  porCliente.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));

  const totalApp = Math.round([...porClienteApp.values()].reduce((a, g) => a + g.monto, 0));
  const totalXubio = Math.round([...porClienteXubio.values()].reduce((a, g) => a + g.monto, 0));
  const base = Math.max(Math.abs(totalApp), Math.abs(totalXubio));
  return {
    desde, hasta, totalApp, totalXubio,
    diferencia: totalApp - totalXubio,
    pct: base > 0 ? Math.round(((totalApp - totalXubio) / base) * 1000) / 10 : null,
    porCliente, disponible: true,
  };
}
