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

import { PROD_KEYS } from './articulos';

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
  dias: DiferenciaDia[]; // en qué días está la diferencia, de mayor a menor
}

// En qué día está la diferencia. Un total por cliente dice que algo no cuadra, pero no
// deja hacer nada: "Mamina −$335.368" obliga a revisar un mes entero de ventas contra un
// mes entero de comprobantes. El día concreto, con el número de factura, convierte eso en
// abrir UN comprobante y comparar.
export interface DiferenciaDia {
  fecha: string;
  app: number;
  xubio: number;
  diferencia: number;
  comprobantes: string[]; // los de Xubio de ese día, para ir directo a buscarlos
  // Con qué otro día se emparejó por importe exacto. No se muestra como diferencia, pero
  // tenerlo permite explicar por qué un día que "no cuadra" no aparece en el informe — si
  // no, la próxima vez que alguien mire la planilla va a creer que el informe se lo comió.
  emparejadaCon?: string;
}

// Abajo de esto, un día no se nombra: es redondeo de precios, no un problema. El umbral
// por día es mucho más chico que el del cliente porque acá ya sabemos que el cliente no
// cuadra; lo único que falta es ubicar dónde.
export const DIF_MINIMA_DIA = 1_000;

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

// IVA que Xubio le agrega a la factura A. La app valoriza NETO —precio por unidad, sin
// impuesto— y Xubio factura con el IVA adentro, así que comparar los dos números crudos daba
// una diferencia del 10,5% en todos los clientes A y hacía ver un problema donde no lo hay:
// en el informe de septiembre, de $3,9 millones de "diferencia", casi todo era esto.
export const IVA_FACTURA_A = 0.105;

// ── Cuánto se puede correr la fecha del comprobante respecto de la entrega ────────────
//
// Era 1 día, y 1 día no alcanza. Lo entregado el viernes y el sábado se factura el lunes:
// son dos y tres días. Un cliente al que se le juntan varios remitos en una factura puede
// estirarse más todavía. Con la ventana en 1, cada uno de esos casos salía como DOS
// diferencias del mismo importe —una de más y otra de menos— y las dos eran la misma cosa
// contada dos veces. El informe se llenaba de ruido y lo real quedaba enterrado.
export const DIAS_CORRIMIENTO = 4;

// ── Emparejar por importe, con la fecha mucho más suelta ──────────────────────────────
//
// Dos montos iguales del mismo cliente, uno en la app y otro en Xubio, dentro de la misma
// quincena, son la misma venta facturada otro día. No hace falta que los días sean vecinos:
// que el importe coincida AL PESO ya es una coincidencia demasiado grande para ser casual.
//
// Esto es lo que saca del informe los casos que más se repiten: la factura 0631 del 01/10 por
// $188.000 contra la entrega del 10/10 por $188.000 no es una diferencia, es la misma venta.
// La compensación por días vecinos nunca las iba a juntar porque están a nueve días.
export const DIAS_MISMO_IMPORTE = 15;

// Cuánto pueden diferir dos importes para considerarlos "el mismo". Fijo y chico: lo que se
// busca son coincidencias exactas, no parecidos — emparejar dos montos que difieren en miles
// taparía una diferencia real.
export const TOLERANCIA_IMPORTE = 100;

// Dos importes son el mismo si coinciden, o si coinciden cuando a uno se le suma el IVA de la
// factura A. Lo segundo cubre al cliente con el tipo de factura mal cargado en la ficha: la
// app valoriza neto, Xubio emite con IVA, y la diferencia es exactamente el 10,5% todos los
// días del mes. Eso es un dato mal cargado, no plata que falte.
export function mismoImporte(a: number, b: number): boolean {
  const x = Math.abs(a), y = Math.abs(b);
  if (Math.abs(x - y) <= TOLERANCIA_IMPORTE) return true;
  if (Math.abs(x * (1 + IVA_FACTURA_A) - y) <= TOLERANCIA_IMPORTE) return true;
  if (Math.abs(y * (1 + IVA_FACTURA_A) - x) <= TOLERANCIA_IMPORTE) return true;
  return false;
}

function llevaIva(cliente: ClienteVenta | undefined): boolean {
  return String(cliente?.tipo_factura || '').trim().toUpperCase() === 'A';
}

// Cuanto vale una fila de venta, a los precios de ese cliente y esa sucursal, con el IVA de
// los clientes con factura A — o sea, el importe con el que esa venta llega a un comprobante
// de Xubio.
//
// Se exporta porque lo necesita el ajuste de facturas corregidas despues de emitidas (ver
// lib/ajusteFactura.ts). Tiene que ser EXACTAMENTE esta cuenta y no una parecida: si el
// ajuste valorizara distinto que el informe de facturacion, cada factura corregida
// aparecería como una diferencia inventada en el informe de los lunes.
export function valorDeVenta(v: VentaDia, precios: PrecioVenta[], clientes: ClienteVenta[]): number {
  const cliente = clientes.find((c) => String(c.id_control) === String(v.id_control));
  let monto = 0;
  for (const key of PROD_KEYS) {
    const qty = Number((v as any)[key]) || 0;
    if (qty <= 0) continue;
    monto += qty * precioDe(precios, String(v.id_control), v.sucursal, key, cliente?.sucursales);
  }
  if (monto <= 0) return 0;
  return llevaIva(cliente) ? monto * (1 + IVA_FACTURA_A) : monto;
}

// Días entre dos fechas YYYY-MM-DD (puede dar negativo).
function diasEntreFechas(a: string, b: string): number {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000);
}

// Corre un día una fecha YYYY-MM-DD.
function diaMas(fecha: string, n: number): string {
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  const porDiaApp = new Map<string, number>();            // "clave||fecha" → monto
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
    // Se le suma el IVA a los clientes con factura A, que es como sale en Xubio. Compararlo
    // sin el impuesto mostraba un 10,5% de diferencia en cada uno de ellos, todos los meses.
    if (llevaIva(cliente)) monto = monto * (1 + IVA_FACTURA_A);
    const prev = porClienteApp.get(clave);
    if (prev) prev.monto += monto;
    else porClienteApp.set(clave, { nombre: nombreClienteVisible(cliente) || String(v.nombre_cliente || clave), monto });
    porDiaApp.set(`${clave}||${f}`, (porDiaApp.get(`${clave}||${f}`) || 0) + monto);
  }

  // Lado Xubio: comprobantes del período, con las notas de crédito (tipo 3) en negativo.
  const porClienteXubio = new Map<string, { nombre: string; monto: number }>();
  const porDiaXubio = new Map<string, { monto: number; comprobantes: string[] }>();
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
    const kd = `${clave}||${f}`;
    const pd = porDiaXubio.get(kd) || { monto: 0, comprobantes: [] };
    pd.monto += monto;
    const nro = String(c?.numeroDocumento || '').trim();
    if (nro && !pd.comprobantes.includes(nro)) pd.comprobantes.push(nro);
    porDiaXubio.set(kd, pd);
  }

  const claves = new Set([...porClienteApp.keys(), ...porClienteXubio.keys()]);
  const porCliente: DiferenciaCliente[] = [];
  for (const k of claves) {
    const app = Math.round(porClienteApp.get(k)?.monto || 0);
    const xubio = Math.round(porClienteXubio.get(k)?.monto || 0);
    const diferencia = app - xubio;
    const base = Math.max(Math.abs(app), Math.abs(xubio));
    const pct = base > 0 ? Math.round((diferencia / base) * 1000) / 10 : null;
    // Se listan por MONTO, sin exigir además un porcentaje. El filtro por proporción
    // estaba pensado para no avisar de redondeos, pero escondía plata real: una diferencia
    // de $60.000 en un cliente que factura $8.000.000 no llega al 2% y se ignoraba, y son
    // $60.000 que igual hay que explicar. El porcentaje sigue calculado como dato.
    if (Math.abs(diferencia) < DIF_MINIMA_PESOS) continue;
    // En qué días está: es lo que convierte el aviso en algo que se puede revisar.
    const dias: DiferenciaDia[] = [];
    const fechas = new Set<string>();
    for (const kk of porDiaApp.keys()) if (kk.startsWith(`${k}||`)) fechas.add(kk.slice(k.length + 2));
    for (const kk of porDiaXubio.keys()) if (kk.startsWith(`${k}||`)) fechas.add(kk.slice(k.length + 2));
    for (const f of fechas) {
      const dApp = Math.round(porDiaApp.get(`${k}||${f}`) || 0);
      const dXu = Math.round(porDiaXubio.get(`${k}||${f}`)?.monto || 0);
      const dDif = dApp - dXu;
      if (Math.abs(dDif) < DIF_MINIMA_DIA) continue;
      dias.push({ fecha: f, app: dApp, xubio: dXu, diferencia: dDif, comprobantes: porDiaXubio.get(`${k}||${f}`)?.comprobantes || [] });
    }
    dias.sort((a, b) => a.fecha.localeCompare(b.fecha));

    // ── Primero, los que coinciden EXACTO en importe ────────────────────────────────
    //
    // Antes que cualquier otra cosa, porque es el emparejamiento más confiable que hay: dos
    // montos iguales del mismo cliente dentro de la quincena son la misma venta facturada
    // otro día. Se cancelan enteros los dos.
    //
    // Va primero y no después de la compensación por vecinos porque si no, un vecino puede
    // "gastar" parte de un día que en realidad correspondía a su par exacto, y quedan dos
    // restos chicos en vez de cero.
    for (let i = 0; i < dias.length; i++) {
      if (Math.abs(dias[i].diferencia) < DIF_MINIMA_DIA) continue;
      const par = dias.find((x, j) =>
        j !== i
        && Math.abs(x.diferencia) >= DIF_MINIMA_DIA
        && Math.sign(x.diferencia) !== Math.sign(dias[i].diferencia)
        && Math.abs(diasEntreFechas(dias[i].fecha, x.fecha)) <= DIAS_MISMO_IMPORTE
        && mismoImporte(dias[i].diferencia, x.diferencia));
      if (!par) continue;
      dias[i].emparejadaCon = par.fecha;
      par.emparejadaCon = dias[i].fecha;
      dias[i].diferencia = 0;
      par.diferencia = 0;
    }

    // ── Después, los días cercanos, compensando parcialmente ────────────────────────
    //
    // Para lo que no coincide al peso: una entrega facturada junto con otra deja un resto que
    // no empareja exacto con nada, pero que se explica con el día de al lado.
    for (let i = 0; i < dias.length; i++) {
      for (let n = 1; n <= DIAS_CORRIMIENTO; n++) {
        const vecino = dias.find((x) => x.fecha === diaMas(dias[i].fecha, n));
        if (!vecino) continue;
        // Solo si apuntan para lados distintos: dos días que faltan los dos no se cancelan.
        if (Math.sign(dias[i].diferencia) === Math.sign(vecino.diferencia)) continue;
        const compensa = Math.min(Math.abs(dias[i].diferencia), Math.abs(vecino.diferencia));
        dias[i].diferencia -= Math.sign(dias[i].diferencia) * compensa;
        vecino.diferencia -= Math.sign(vecino.diferencia) * compensa;
      }
    }
    // Lo que quedó por debajo del umbral después de compensar ya no es una diferencia.
    const diasReales = dias.filter((x) => Math.abs(x.diferencia) >= DIF_MINIMA_DIA);
    dias.length = 0;
    dias.push(...diasReales);
    dias.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
    porCliente.push({
      cliente: porClienteApp.get(k)?.nombre || porClienteXubio.get(k)?.nombre || k,
      app, xubio, diferencia, pct, dias,
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
