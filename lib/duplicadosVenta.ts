// ══ Ventas y facturas repetidas ══════════════════════════════════════════════════════
//
// El 26-nov-2026 se duplicó la facturación de un día entero. El primer arreglo fue un
// freno al emitir: antes de mandar una factura se le pregunta a Xubio si ya tiene una
// igual. Sirve, pero llega tarde y tapa poco. Tarde, porque aparece después de apretar el
// botón, como un renglón en una lista de errores, cuando el dato ya se podía saber antes.
// Y tapa poco, porque solo reconoce la forma exacta del duplicado: mismo cliente, mismo
// día, mismo importe. Si las filas de la venta se duplicaron ANTES de facturar, sale una
// sola factura con las cantidades al doble y el freno no ve nada.
//
// Lo que faltaba no era un freno más: era que la app se diera cuenta sola. Ayer nadie se
// enteró por la app — se enteró Marcos mirando. Esto calcula las dos formas que tiene el
// problema, para que las dos se puedan avisar en pantalla y por mail:
//
//   · VENTAS REPETIDAS (acá, en nuestra planilla). Es la causa, y la única que todavía se
//     puede arreglar gratis: borrar una fila. Pasa porque guardar busca la fila existente
//     ENTRE LAS NO EXPORTADAS: si la venta ya salió facturada, no la encuentra y crea otra.
//
//   · FACTURAS REPETIDAS (allá, en Xubio). Es la consecuencia, y ya no es gratis: se
//     arregla con una nota de crédito. Pero hay que saber que existe — un comprobante de
//     más que nadie mira le queda al cliente como deuda.
//
// Las dos son cálculos puros sobre datos que la app ya lee. No consultan nada: quien las
// usa trae las filas y los comprobantes, así que el número de la alerta en pantalla y el
// del mail no pueden discrepar.

import type { VentaDia, ClienteVenta } from './types';
import { tieneCantidad } from './clavesVenta';
import { claveComprobante } from './comprobantes';
import { mismoImporte } from './controlFacturacion';

const soloDia = (f: any) => String(f || '').split(/[T ]/)[0];

const norm = (s: string) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// ── Una venta cargada dos veces ─────────────────────────────────────────────────────

export interface VentaRepetida {
  fecha: string;
  id_control: string;
  cliente: string;
  sucursal: string;
  // Los comprobantes que ya salieron de este cliente/sucursal/fecha. Con dos o más, la
  // factura de más YA está emitida.
  comprobantes: string[];
  // Filas cargadas con mercadería y todavía sin facturar, sobre algo que ya se facturó.
  // Son las que se pueden borrar sin consecuencias: nada salió a AFIP por ellas.
  filasSinFacturar: string[];
  // Qué forma tiene el problema, que decide qué hay que hacer:
  //   'por_facturar' → hay una carga de más que todavía NO se facturó. Borrarla.
  //   'ya_facturada' → salieron dos o más comprobantes. Nota de crédito.
  //   'ambas'        → las dos cosas a la vez.
  forma: 'por_facturar' | 'ya_facturada' | 'ambas';
}

// Clientes/fechas donde la venta está cargada más de una vez.
//
// La clave es cliente + sucursal + fecha, no cliente + fecha: un cliente con dos sucursales
// tiene legítimamente dos filas el mismo día, y tratarlas como repetidas convertiría a los
// clientes más grandes en una alerta permanente — que es la forma más rápida de que nadie
// lea ninguna.
//
// SIN MÍNIMO DE DÍAS, a propósito. La alerta de "ventas sin facturar" empieza a los dos
// días, porque una venta de hoy todavía no tiene por qué estar facturada. Acá es al revés:
// la fila repetida de hoy es justo la que todavía se puede borrar antes de que se convierta
// en un comprobante. Esperar dos días para avisarla es avisar cuando ya no sirve.
export function ventasRepetidas(
  ventas: VentaDia[], clientes: ClienteVenta[], claves: string[],
): VentaRepetida[] {
  const nombres = new Map(clientes.map((c) => [String(c.id_control), String(c.nombre_display || c.nombre_xubio || c.id_control)]));

  interface Grupo { comprobantes: Set<string>; sinFacturar: string[] }
  const grupos = new Map<string, Grupo>();
  for (const v of ventas || []) {
    const fecha = soloDia(v.fecha);
    if (!fecha) continue;
    if (!tieneCantidad(v, claves)) continue;
    const k = `${String(v.id_control)}||${String(v.sucursal || '')}||${fecha}`;
    const g = grupos.get(k) || { comprobantes: new Set<string>(), sinFacturar: [] };
    const exp = String(v.exportado || '').trim();
    // PENDIENTE no es un comprobante: es una fila en la cola, todavía sin facturar. Darla
    // por facturada haría que una carga repetida en la cola se vea como ya emitida.
    if (exp && exp !== 'PENDIENTE') g.comprobantes.add(exp);
    else g.sinFacturar.push(String(v.id_venta || ''));
    grupos.set(k, g);
  }

  const out: VentaRepetida[] = [];
  for (const [k, g] of grupos) {
    const [id_control, sucursal, fecha] = k.split('||');
    // Los comprobantes se cuentan por clave: el mismo número escrito distinto no son dos.
    const numeros = [...g.comprobantes];
    const distintos = new Set(numeros.map((n) => claveComprobante(n) || n)).size;
    const yaFacturada = distintos > 1;
    const porFacturar = numeros.length > 0 && g.sinFacturar.length > 0;
    if (!yaFacturada && !porFacturar) continue;
    out.push({
      fecha, id_control, sucursal,
      cliente: nombres.get(id_control) || id_control,
      comprobantes: numeros.sort(),
      filasSinFacturar: g.sinFacturar,
      forma: yaFacturada && porFacturar ? 'ambas' : yaFacturada ? 'ya_facturada' : 'por_facturar',
    });
  }
  // Lo más nuevo primero: es lo que todavía se puede arreglar.
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.cliente.localeCompare(b.cliente));
}

// Lo que hay que hacer con cada una, en una línea. Va en la alerta y en el mail: una alerta
// que dice qué pasa y no qué hacer se vuelve parte del paisaje.
export function queHacerConLaRepetida(r: VentaRepetida): string {
  if (r.forma === 'por_facturar') {
    return `Ya salió ${r.comprobantes.join(', ')} y quedó ${r.filasSinFacturar.length === 1 ? 'otra carga' : `${r.filasSinFacturar.length} cargas más`} `
      + `sin facturar. Si es la misma venta cargada de nuevo, borrala desde Historial → No facturado antes de que se facture.`;
  }
  if (r.forma === 'ya_facturada') {
    return `Salieron ${r.comprobantes.length} comprobantes: ${r.comprobantes.join(', ')}. `
      + `Si uno está de más hay que anularlo con una nota de crédito — ya está en AFIP.`;
  }
  return `Salieron ${r.comprobantes.length} comprobantes (${r.comprobantes.join(', ')}) y además quedan `
    + `${r.filasSinFacturar.length} carga(s) sin facturar. Las sin facturar se borran; el comprobante de más se anula con nota de crédito.`;
}

// ── Dos facturas iguales en Xubio ───────────────────────────────────────────────────

export interface FacturaRepetida {
  cliente: string;
  fecha: string;
  importe: number;
  numeros: string[];
}

// Facturas del mismo cliente, el mismo día y por el mismo importe. Es la huella que deja
// una duplicación ya consumada — la de ayer, o una que se haya forzado con "Emitir igual".
//
// El importe se compara con mismoImporte(), que tolera $100 y acepta la misma cifra con y
// sin IVA. Acá los dos lados son de Xubio, así que la parte del IVA no haría falta; la
// tolerancia sí, porque dos comprobantes del mismo pedido pueden diferir en el redondeo de
// un renglón y seguir siendo el mismo duplicado.
export function facturasRepetidas(comprobantes: any[]): FacturaRepetida[] {
  interface F { cliente: string; fecha: string; numero: string; importe: number }
  const facturas: F[] = [];
  for (const c of comprobantes || []) {
    if (Number(c?.tipo) !== 1) continue;
    const numero = String(c?.numeroDocumento || '').trim();
    const fecha = soloDia(c?.fecha);
    const cliente = String(c?.cliente?.nombre ?? c?.nombre ?? (typeof c?.cliente === 'string' ? c.cliente : '') ?? '').trim();
    const importe = Number(c?.importetotal) || 0;
    if (!numero || !fecha || !cliente || !importe) continue;
    facturas.push({ cliente, fecha, numero, importe });
  }

  // Por cliente y día; dentro de cada día se agrupan por importe parecido. No se puede
  // agrupar por importe exacto con un Map: la tolerancia no es una igualdad y no sirve de
  // clave.
  const porDia = new Map<string, F[]>();
  for (const f of facturas) {
    const k = `${norm(f.cliente)}||${f.fecha}`;
    const l = porDia.get(k) || [];
    l.push(f);
    porDia.set(k, l);
  }

  const out: FacturaRepetida[] = [];
  for (const lista of porDia.values()) {
    if (lista.length < 2) continue;
    const usados = new Set<string>();
    for (const a of lista) {
      if (usados.has(a.numero)) continue;
      const iguales = lista.filter((b) => !usados.has(b.numero) && mismoImporte(a.importe, b.importe));
      if (iguales.length < 2) continue;
      for (const b of iguales) usados.add(b.numero);
      out.push({
        cliente: a.cliente,
        fecha: a.fecha,
        importe: Math.round(a.importe),
        numeros: iguales.map((b) => b.numero).sort(),
      });
    }
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.importe - a.importe);
}

// ── Lo que ya se le facturó a cada cliente en una fecha ─────────────────────────────
//
// Esto ya se calculaba, pero solo DESPUÉS de emitir, en el acuse (ver acuseFacturacion.ts
// → facturadoAntes). El mismo dato sirve mucho más antes: al elegir la fecha en la pantalla
// de carga, saber a quién ya se le facturó ese día es lo que evita cargarle la venta otra
// vez. Un aviso que llega después de la acción no es un aviso, es una explicación.
export interface YaFacturadoEseDia {
  id_control: string;
  cliente: string;
  comprobantes: string[];
}

export function yaFacturadoEnLaFecha(
  ventas: VentaDia[], clientes: ClienteVenta[], fecha: string, claves: string[],
): YaFacturadoEseDia[] {
  const nombres = new Map(clientes.map((c) => [String(c.id_control), String(c.nombre_display || c.nombre_xubio || c.id_control)]));
  const porCliente = new Map<string, Set<string>>();
  for (const v of ventas || []) {
    if (soloDia(v.fecha) !== fecha) continue;
    const exp = String(v.exportado || '').trim();
    if (!exp || exp === 'PENDIENTE') continue;
    if (!tieneCantidad(v, claves)) continue;
    const id = String(v.id_control);
    const s = porCliente.get(id) || new Set<string>();
    s.add(exp);
    porCliente.set(id, s);
  }
  return [...porCliente.entries()]
    .map(([id_control, comps]) => ({
      id_control,
      cliente: nombres.get(id_control) || id_control,
      comprobantes: [...comps].sort(),
    }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
}
