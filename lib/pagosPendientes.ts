// ── Los pagos pendientes, para el mail de todas las mañanas ──────────────────────────
//
// El problema real: Franco (o quien sea) compra algo y manda una solicitud de pago por
// mail. Ese mail es el único lugar donde existe el dato, así que hay que buscarlo entre
// todo lo demás, y si se pierde, la compra no se paga y nadie se entera hasta que llama el
// proveedor.
//
// La app ya sabía todo esto: una compra cargada con "todavía no lo pagué" queda con
// `estado_pago = pendiente`, su proveedor y su vencimiento. Lo que faltaba era que saliera
// sola, en un solo lugar, todos los días — y el alias a dónde transferir, que es el único
// dato que el mail de solicitud traía y la app no.
//
// Lo que se decidió acá y vale la pena dejar escrito:
//
// · Entra TODO lo pendiente, no solo lo vencido. La alerta de vencidas ya existe y es otra
//   cosa: avisa de un problema. Esto es una lista de trabajo — lo que hay para pagar —, y
//   una lista que solo muestra lo que ya se pasó de fecha llega siempre tarde por diseño.
//
// · Se ordena por vencimiento, lo más urgente arriba, y lo que no tiene fecha va al final.
//   Sin vencimiento no es un error: hay compras que no tienen plazo. Pero tampoco pueden
//   encabezar la lista, porque entonces lo que vence mañana queda abajo.
//
// · Se agrupa por proveedor con su total y su alias. Se paga por proveedor, no compra por
//   compra: tres facturas de Orenmas son una transferencia, no tres.

import { deudaProveedores, type DeudaProveedor } from './proveedores';
import type { Gasto } from './types';

export interface ResumenPagos {
  proveedores: DeudaProveedor[];
  total: number;
  vencido: number;
  // Cuántas compras pendientes no tienen alias cargado. No es un error —se puede pagar en
  // efectivo o con cheque— pero es lo que hace falta decir para que se cargue la próxima
  // vez: un mail que no dice qué le falta no mejora nunca.
  sinAlias: number;
  sinVencimiento: number;
  cuantas: number;
}

export function resumenPagosPendientes(gastos: Gasto[], hoy: string): ResumenPagos {
  const proveedores = deudaProveedores(gastos, hoy);
  let total = 0, vencido = 0, sinAlias = 0, sinVencimiento = 0, cuantas = 0;
  for (const p of proveedores) {
    total += p.total;
    vencido += p.vencido;
    for (const i of p.items) {
      cuantas++;
      if (!p.alias) sinAlias++;
      if (!i.vencimiento) sinVencimiento++;
    }
  }
  return { proveedores, total, vencido, sinAlias, sinVencimiento, cuantas };
}

// Lo más urgente de todo, aplanado y ordenado por fecha de vencimiento. Es la vista que
// sirve para decidir qué se paga hoy, que no es la misma que "cuánto le debo a cada uno".
export interface PagoPendiente {
  id_gasto: string;
  proveedor: string;
  descripcion: string;
  monto: number;
  vencimiento: string;
  diasParaVencer: number | null;
  alias: string;
}

export function porVencimiento(proveedores: DeudaProveedor[]): PagoPendiente[] {
  const todas: PagoPendiente[] = [];
  for (const p of proveedores) {
    for (const i of p.items) {
      todas.push({
        id_gasto: i.id_gasto,
        proveedor: p.proveedor,
        descripcion: i.descripcion,
        monto: i.monto,
        vencimiento: i.vencimiento,
        diasParaVencer: i.diasParaVencer,
        alias: i.alias || p.alias || '',
      });
    }
  }
  // Lo que vence antes primero; lo que no tiene fecha, al final. Un vencimiento ilegible ya
  // viene como vacío desde fechaISO, así que cae acá y no se cuela como si venciera en 1970.
  return todas.sort((a, b) => {
    if (!a.vencimiento && !b.vencimiento) return b.monto - a.monto;
    if (!a.vencimiento) return 1;
    if (!b.vencimiento) return -1;
    return a.vencimiento.localeCompare(b.vencimiento);
  });
}
