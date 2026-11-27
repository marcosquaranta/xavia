// ── Dos facturas iguales el mismo día ────────────────────────────────────────────────
//
// El 26-nov-2026 se duplicaron todas las facturas de un día. La app no tenía nada que lo
// impidiera: cada pedido de emisión es independiente, mira la hoja, encuentra ventas sin
// facturar y emite. Si el mismo pedido llega dos veces —doble click, una request que
// pareció colgarse y se reintentó, dos pestañas abiertas— las dos corridas pasan por el
// mismo camino y las dos emiten.
//
// El estado de la hoja no alcanza como freno: la marca de "ya facturada" se escribe DESPUÉS
// de que Xubio acepta el comprobante, así que dos corridas que arrancan juntas leen las dos
// la misma venta en borrador. Es una carrera, y el perdedor es una factura de más en AFIP.
//
// Entonces el freno se pone contra lo único que no se puede duplicar sin que se note: lo
// que Xubio YA tiene. Antes de emitir se le pregunta qué comprobantes hay, y si ya existe
// uno del MISMO cliente, el MISMO día y por el MISMO importe, no se emite y se avisa.
//
// ── Lo que esto cuesta ──────────────────────────────────────────────────────────────
//
// Hay un caso legítimo que queda frenado: un cliente al que de verdad se le factura dos
// veces en el día por exactamente el mismo importe. Pasa (dos entregas iguales, dos
// sucursales que compran lo mismo). Por eso esto NO es un bloqueo definitivo: es una
// advertencia que deja la mercadería sin facturar, a la vista, con un botón para emitirla
// igual. Frenar algo que se puede desfrenar en un click es barato; una factura de más en
// AFIP se arregla con una nota de crédito.

import { mismoImporte } from './controlFacturacion';

const norm = (s: string) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

const soloDia = (v: any) => String(v || '').split(/[T ]/)[0];

// El nombre del cliente de un comprobante de Xubio. Viene como objeto o como string según
// el endpoint — leerlo directo da "[object Object]" y nunca matchea (ver controlLetra.ts).
function nombreCliente(c: any): string {
  return String(c?.cliente?.nombre ?? c?.nombre ?? (typeof c?.cliente === 'string' ? c.cliente : '') ?? '');
}

function idCliente(c: any): number {
  return Number(c?.cliente?.ID ?? c?.cliente?.id ?? 0) || 0;
}

export interface FacturaYaEmitida {
  numero: string;
  fecha: string;
  total: number;
}

// ¿Xubio ya tiene una factura de este cliente, este día, por este importe?
//
// El importe se compara con mismoImporte(), que acepta la misma cifra con y sin IVA: la app
// valoriza neto y Xubio factura con el impuesto adentro, así que comparar crudo no
// encontraría NUNCA el duplicado de una factura A — justo las que importan.
//
// El cliente se compara por id de Xubio cuando el comprobante lo trae, y por nombre
// normalizado si no. Las dos cosas, no una: si el bean no expone el id y solo se comparara
// por id, el freno no frenaría nada y nadie se enteraría.
export function facturaYaEmitida(
  comprobantes: any[],
  args: { clienteId: number; nombreXubio: string; fecha: string; totalNeto: number },
): FacturaYaEmitida | null {
  const dia = soloDia(args.fecha);
  const nombre = norm(args.nombreXubio);
  for (const c of comprobantes || []) {
    // Solo facturas. Una nota de crédito del mismo importe el mismo día es lo contrario de
    // un duplicado: es la corrección.
    if (Number(c?.tipo) !== 1) continue;
    if (soloDia(c?.fecha) !== dia) continue;
    const cid = idCliente(c);
    const esMismoCliente = cid && args.clienteId ? cid === args.clienteId : norm(nombreCliente(c)) === nombre;
    if (!esMismoCliente) continue;
    const total = Number(c?.importetotal) || 0;
    if (!mismoImporte(args.totalNeto, total)) continue;
    return { numero: String(c?.numeroDocumento || '').trim(), fecha: dia, total: Math.round(total) };
  }
  return null;
}

// El mensaje que ve el que facturó. Dice qué se frenó, por qué, y que se puede forzar —
// un freno cuya salida no está escrita se lee como una falla de la app.
export function mensajeDuplicado(ya: FacturaYaEmitida): string {
  const $ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  return `No se emitió: Xubio ya tiene la factura ${ya.numero || '(sin número)'} de este cliente, `
    + `del ${ya.fecha}, por ${$(ya.total)} — el mismo importe. `
    + `Si de verdad hay que facturar dos veces lo mismo el mismo día, se fuerza desde `
    + `Facturación con el botón "Emitir igual".`;
}
