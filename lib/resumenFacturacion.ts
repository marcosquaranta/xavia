// ── Qué se facturó y qué no, día por día ─────────────────────────────────────────────
//
// El aviso que faltaba. Había uno de ventas sin facturar, pero solo miraba una franja de
// dos días (entre 2 y 3 de antigüedad): una venta de ayer era "demasiado nueva" y una de
// hace nueve días "demasiado vieja", así que las dos que estaban ahí sin facturar no salían
// en ningún mail. Un aviso con una rendija así no avisa, tranquiliza.
//
// Y le faltaba la otra mitad. Ver solo lo que NO se facturó no deja detectar lo que se
// facturó de más, que es el error caro: la misma venta cargada dos veces sale dos veces y
// el cliente recibe dos facturas. Por eso acá van las dos columnas del mismo día, juntas.
//
// ── Las dos señales de duplicado ──
//
// 1. Un cliente con DOS comprobantes distintos el mismo día. A veces es real —dos entregas,
//    dos remitos— pero casi siempre es la misma venta facturada dos veces.
//
// 2. Un cliente que ese día tiene factura emitida Y además una carga pendiente. Lo más
//    probable es que la carga pendiente sea una copia de la que ya se facturó: facturarla
//    sería emitir la segunda factura con la mano.
//
// Ninguna de las dos es un veredicto, y el mail las nombra como lo que son: algo para
// mirar. Decirle "duplicada" a una entrega real haría que se borre una venta que existió.

import type { VentaDia, ClienteVenta } from './types';
import { PROD_KEYS } from './articulos';
import { claveComprobante } from './comprobantes';

export interface ClienteFacturado {
  id_control: string;
  cliente: string;
  numeros: string[];   // los comprobantes de ese día
  filas: number;
}

export interface ClientePendiente {
  id_control: string;
  cliente: string;
  filas: number;
  // Ese mismo día ese cliente SÍ tiene factura. Señal de carga repetida.
  tambienFacturado: boolean;
}

export interface DiaFacturacion {
  fecha: string;
  dias: number;              // antigüedad en días
  facturados: ClienteFacturado[];
  pendientes: ClientePendiente[];
  // Clientes con más de un comprobante ese día.
  conVariosComprobantes: ClienteFacturado[];
}

export interface ResumenFacturacion {
  desde: string;
  hasta: string;
  dias: DiaFacturacion[];
  totalPendientes: number;
  totalFacturados: number;
  // Las dos señales, ya juntadas para el encabezado del mail.
  sospechas: {
    variosComprobantes: { fecha: string; cliente: string; numeros: string[] }[];
    pendienteConFactura: { fecha: string; cliente: string }[];
  };
}

const soloDia = (f: any) => String(f || '').split(/[T ]/)[0];
const tieneCantidad = (v: any, extra: string[]) =>
  PROD_KEYS.some((k) => (Number(v?.[k]) || 0) > 0) || extra.some((k) => (Number(v?.[k]) || 0) > 0);

export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`), b = Date.parse(`${hasta}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function armarResumen(args: {
  ventas: VentaDia[];
  clientes: ClienteVenta[];
  hoy: string;
  dias?: number;
  // Artículos dados de alta desde la app: sin ellos, una venta que solo lleva uno de esos
  // se vería como una fila vacía y no se reclamaría nunca.
  clavesExtra?: string[];
}): ResumenFacturacion {
  const { ventas, clientes, hoy } = args;
  const ventana = args.dias ?? 7;
  const clavesExtra = args.clavesExtra || [];
  const desde = sumarDias(hoy, -(ventana - 1));

  const nombres = new Map(clientes.map((c) => [
    String(c.id_control),
    String(c.nombre_display || c.nombre_xubio || c.id_control),
  ]));

  // fecha → id_control → acumulado
  const porDia = new Map<string, Map<string, { numeros: Set<string>; facturadas: number; pendientes: number }>>();

  for (const v of ventas) {
    const fecha = soloDia(v.fecha);
    if (!fecha || fecha < desde || fecha > hoy) continue;
    if (!tieneCantidad(v, clavesExtra)) continue;
    const id = String(v.id_control || '').trim();
    if (!id) continue;

    const delDia = porDia.get(fecha) || new Map();
    const acc = delDia.get(id) || { numeros: new Set<string>(), facturadas: 0, pendientes: 0 };
    const numero = String((v as any).exportado || '').trim();
    // "PENDIENTE" es la marca de que se mandó a facturar y Xubio todavía no devolvió el
    // número. No es una factura emitida: contarla como tal taparía justo el caso en que
    // algo se quedó a mitad de camino.
    if (numero && numero.toUpperCase() !== 'PENDIENTE') {
      acc.numeros.add(numero);
      acc.facturadas++;
    } else {
      acc.pendientes++;
    }
    delDia.set(id, acc);
    porDia.set(fecha, delDia);
  }

  const dias: DiaFacturacion[] = [];
  const variosComprobantes: { fecha: string; cliente: string; numeros: string[] }[] = [];
  const pendienteConFactura: { fecha: string; cliente: string }[] = [];

  for (const [fecha, delDia] of [...porDia.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const facturados: ClienteFacturado[] = [];
    const pendientes: ClientePendiente[] = [];
    const conVarios: ClienteFacturado[] = [];

    for (const [id, acc] of delDia) {
      const cliente = nombres.get(id) || id;
      // Por CLAVE y no por texto: el mismo comprobante escrito distinto contaría como dos
      // y marcaría un duplicado que no existe.
      const claves = new Map<string, string>();
      for (const n of acc.numeros) claves.set(claveComprobante(n), n);
      const numeros = [...claves.values()].sort();

      if (numeros.length) {
        const f: ClienteFacturado = { id_control: id, cliente, numeros, filas: acc.facturadas };
        facturados.push(f);
        if (numeros.length > 1) {
          conVarios.push(f);
          variosComprobantes.push({ fecha, cliente, numeros });
        }
      }
      if (acc.pendientes > 0) {
        const tambienFacturado = numeros.length > 0;
        pendientes.push({ id_control: id, cliente, filas: acc.pendientes, tambienFacturado });
        if (tambienFacturado) pendienteConFactura.push({ fecha, cliente });
      }
    }

    facturados.sort((a, b) => a.cliente.localeCompare(b.cliente));
    pendientes.sort((a, b) => a.cliente.localeCompare(b.cliente));

    dias.push({
      fecha,
      dias: diasEntre(fecha, hoy),
      facturados,
      pendientes,
      conVariosComprobantes: conVarios,
    });
  }

  return {
    desde, hasta: hoy, dias,
    totalPendientes: dias.reduce((a, d) => a + d.pendientes.length, 0),
    totalFacturados: dias.reduce((a, d) => a + d.facturados.length, 0),
    sospechas: { variosComprobantes, pendienteConFactura },
  };
}

// Los días que tienen algo que contar. Un día entero sin ventas —un domingo— no aporta
// nada y llena el mail de filas vacías.
export function diasConAlgo(r: ResumenFacturacion): DiaFacturacion[] {
  return r.dias.filter((d) => d.facturados.length > 0 || d.pendientes.length > 0);
}

// Si hay algo que amerite mandar el mail. Un resumen que todos los días dice "todo bien" se
// archiva sin abrir, y el día que trae algo se archiva igual.
export function valeLaPena(r: ResumenFacturacion): boolean {
  return r.totalPendientes > 0
    || r.sospechas.variosComprobantes.length > 0
    || r.sospechas.pendienteConFactura.length > 0;
}
