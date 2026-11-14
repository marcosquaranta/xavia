// ── ¿La factura va a salir a nombre del cliente que cargó la venta? ──────────────────
//
// El caso real: se cargan ventas a La Gallega y la factura sale a nombre de Rosental.
//
// Cómo puede pasar. La venta guarda el `id_control` del cliente, y al facturar se busca la
// ficha con ese id. Esa búsqueda se hace con un Map armado así:
//
//     new Map(clientes.map(c => [c.id_control, c]))
//
// Si DOS fichas tienen el mismo `id_control`, el Map se queda con la última y nadie se
// entera. La venta dice "cliente 7" y el que factura es el otro cliente 7. Que eso sea
// posible no es hipotético: al borrar una ficha su id queda libre y el próximo cliente que
// se cree lo reusa, así que basta con que una baja no haya terminado bien.
//
// Pero el id no es el único dato que la venta guarda: también queda escrito el NOMBRE del
// cliente en el momento de cargarla. Son dos testigos del mismo hecho, y cuando dos
// testigos no coinciden, lo que no se puede hacer es elegir uno y seguir — menos todavía
// cuando el resultado se emite en AFIP a nombre de una empresa.
//
// Entonces, antes de facturar:
//
//  1. Si el `id_control` está repetido en la hoja de Clientes, no se factura esa venta. No
//     hay forma de saber cuál de las dos fichas es, y adivinar es emitir a nombre de
//     cualquiera.
//
//  2. Si el nombre que quedó en la venta corresponde a OTRA ficha —no a la que el id
//     señala— tampoco se factura. Eso ya no es un nombre viejo: es el id apuntando a un
//     cliente y el nombre a otro.
//
// Lo que NO bloquea: un nombre que no coincide con ninguna ficha. Eso es simplemente un
// nombre viejo o escrito distinto, pasa todo el tiempo, y frenar por eso sería dejar de
// facturar por un motivo que no es un error.

import type { ClienteVenta } from './types';

export const norm = (s: any) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export interface ProblemaIdentidad {
  tipo: 'id_repetido' | 'nombre_de_otro';
  mensaje: string;
}

// Los id_control que aparecen más de una vez. Cada uno es una factura esperando salir a
// nombre equivocado.
export function idsRepetidos(clientes: ClienteVenta[]): Map<string, ClienteVenta[]> {
  const porId = new Map<string, ClienteVenta[]>();
  for (const c of clientes || []) {
    const id = String(c?.id_control || '').trim();
    if (!id) continue;
    (porId.get(id) || porId.set(id, []).get(id)!).push(c);
  }
  const repetidos = new Map<string, ClienteVenta[]>();
  for (const [id, lista] of porId) if (lista.length > 1) repetidos.set(id, lista);
  return repetidos;
}

// Todos los nombres con los que se conoce a una ficha: razón social, nombre de pantalla y
// alias. Un alias alcanza para identificarla — es lo que alguien escribe al cargar.
function nombresDe(c: ClienteVenta): string[] {
  return [c?.nombre_xubio, (c as any)?.nombre_display, (c as any)?.alias]
    .map(norm).filter(Boolean);
}

// ¿El nombre que quedó escrito en la venta es el de OTRA ficha?
//
// Devuelve la otra ficha, o undefined. Solo mira nombres que identifican a alguien: si el
// nombre de la venta no es de nadie, no hay contradicción que reportar.
export function fichaQueDiceElNombre(
  nombreEnLaVenta: string, idAsignado: string, clientes: ClienteVenta[],
): ClienteVenta | undefined {
  const k = norm(nombreEnLaVenta);
  if (!k) return undefined;
  const asignada = (clientes || []).find((c) => String(c?.id_control || '') === String(idAsignado));
  // Si el nombre es uno de los de la ficha asignada, los dos testigos coinciden.
  if (asignada && nombresDe(asignada).includes(k)) return undefined;
  return (clientes || []).find((c) =>
    String(c?.id_control || '') !== String(idAsignado) && nombresDe(c).includes(k));
}

// El chequeo completo para una venta a punto de facturarse.
export function revisarIdentidad(
  idControl: string, nombreEnLaVenta: string, clientes: ClienteVenta[],
  repetidos = idsRepetidos(clientes),
): ProblemaIdentidad | null {
  const id = String(idControl || '').trim();
  const dobles = repetidos.get(id);
  if (dobles && dobles.length > 1) {
    const cuales = dobles.map((c) => `"${c.nombre_xubio || (c as any).nombre_display || '(sin nombre)'}"`).join(' y ');
    return {
      tipo: 'id_repetido',
      mensaje: `El código de cliente ${id} está cargado en ${dobles.length} fichas distintas (${cuales}). `
        + `La factura saldría a nombre de cualquiera de las dos, así que no se emite. `
        + `Entrá a Admin → Clientes y dejá una sola ficha con ese código.`,
    };
  }

  const otra = fichaQueDiceElNombre(nombreEnLaVenta, id, clientes);
  if (otra) {
    const asignada = (clientes || []).find((c) => String(c?.id_control || '') === id);
    return {
      tipo: 'nombre_de_otro',
      mensaje: `Esta venta dice "${nombreEnLaVenta}" pero su código de cliente (${id}) es el de `
        + `"${asignada?.nombre_xubio || '(ficha desconocida)'}". La factura saldría a nombre de esta última. `
        + `No se emite: corregí el cliente de la venta, o el código de la ficha de "${otra.nombre_xubio || nombreEnLaVenta}".`,
    };
  }

  return null;
}
