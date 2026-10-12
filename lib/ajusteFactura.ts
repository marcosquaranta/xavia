import { appendRowObj, asegurarHoja, readSheet, updateRow } from './sheets';
import { claveComprobante } from './comprobantes';
import { fechaArgentinaHoy } from './ocupacion';
import { valorDeVenta } from './controlFacturacion';
import type { VentaDia, PrecioVenta, ClienteVenta } from './types';

// ── Facturas corregidas después de emitidas ───────────────────────────────────────────
//
// Una factura sale a Xubio por lo que decía la venta en ese momento. Después aparece lo que
// de verdad recibió el cliente: faltaban 40 rúculas, se devolvió un cajón, se cargó una
// sucursal de más. Eso se corrige en el historial de ventas, y hasta ahora ahí terminaba la
// historia: la venta quedaba bien en la app y el monto a cobrar seguía siendo el de la
// factura vieja, porque la deuda sale del comprobante de Xubio.
//
// Resultado: se le reclamaba al cliente un importe que los dos sabían que no era. Y el que
// miraba la pantalla no tenía forma de notarlo, porque el número que mostraba era el de la
// factura — correcto como comprobante y equivocado como deuda.
//
// Esta hoja guarda esa corrección: para esta factura, cobrar X en vez de Y. No toca Xubio a
// propósito. Formalmente lo que corresponde es una nota de crédito, y mientras no se emita,
// la factura sigue diciendo lo que dice; lo que cambia es lo que la app reclama y da por
// pendiente, que es lo que se usa todos los días.
//
// Se escribe sola cuando se guarda una edición sobre una venta ya facturada: pedirle a
// alguien que además venga acá a anotar el ajuste es garantizar que la mitad de las veces no
// pase. Y por eso guarda los dos importes y la fecha: para que se pueda ver qué dice la
// factura, qué se decidió cobrar y cuándo se decidió.

export const HOJA_AJUSTES = 'AjustesFactura';
export const HEADERS_AJUSTES = [
  'numero', 'id_control', 'cliente', 'importe_xubio', 'importe_app',
  'fecha_ajuste', 'motivo', 'usuario', 'estado',
];

export interface AjusteFactura {
  numero: string;
  id_control: string;
  cliente: string;
  // Lo que dice el comprobante en Xubio cuando se hizo el ajuste.
  importe_xubio: number | string;
  // Lo que valen las ventas de esa factura DESPUÉS de corregirlas. Es lo que se cobra.
  importe_app: number | string;
  fecha_ajuste: string;
  motivo: string;
  usuario: string;
  estado: 'activo' | 'revertido' | string;
}

export interface AjusteAplicado {
  importeApp: number;
  importeXubio: number;
  diferencia: number;
  fecha: string;
  motivo: string;
}

export async function leerAjustes(): Promise<AjusteFactura[]> {
  return readSheet<AjusteFactura>(HOJA_AJUSTES).catch(() => []);
}

// Por CLAVE de comprobante, igual que todo lo demás: el mismo número escrito distinto —con
// o sin ceros a la izquierda, con espacio en vez de guion— no se reconocería, y el ajuste se
// perdería justo en la factura que alguien se tomó el trabajo de corregir.
export function ajustesPorFactura(filas: AjusteFactura[]): Map<string, AjusteAplicado> {
  const out = new Map<string, AjusteAplicado>();
  for (const f of filas || []) {
    if (String(f?.estado) === 'revertido') continue;
    const k = claveComprobante(f?.numero);
    if (!k) continue;
    const app = Math.round(Number(f.importe_app) || 0);
    const xubio = Math.round(Number(f.importe_xubio) || 0);
    // Un ajuste que no cambia nada no es un ajuste: mostrarlo solo agrega ruido en una
    // pantalla donde lo que importa es ver las pocas que sí cambiaron.
    if (app <= 0 || app === xubio) continue;
    out.set(k, { importeApp: app, importeXubio: xubio, diferencia: app - xubio, fecha: String(f.fecha_ajuste || ''), motivo: String(f.motivo || '') });
  }
  return out;
}

// Lo que valen HOY, a los precios de cada cliente, las ventas que fueron a parar a una
// factura. Es el mismo cálculo que usa el control de facturación de los lunes —precio por
// sucursal, IVA para los clientes con factura A—: si fuera otro, la pantalla y el informe
// dirían cosas distintas de la misma factura.
export function valorDeFactura(
  numero: string, ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[],
): { monto: number; filas: number; id_control: string; cliente: string } {
  const k = claveComprobante(numero);
  let monto = 0, filas = 0, id_control = '', cliente = '';
  for (const v of ventas || []) {
    if (claveComprobante(v.exportado) !== k) continue;
    filas++;
    if (!id_control) id_control = String(v.id_control || '');
    if (!cliente) cliente = String(v.nombre_cliente || '');
    monto += valorDeVenta(v, precios, clientes);
  }
  return { monto: Math.round(monto), filas, id_control, cliente };
}

// Deja asentado el ajuste. Una fila por factura: si se corrige dos veces, lo que vale es la
// última corrección, no las dos sumadas.
export async function guardarAjuste(a: {
  numero: string; id_control: string; cliente: string;
  importeXubio: number; importeApp: number; motivo: string; usuario: string;
}): Promise<void> {
  await asegurarHoja(HOJA_AJUSTES, HEADERS_AJUSTES);
  const fila = {
    numero: String(a.numero).trim(),
    id_control: a.id_control,
    cliente: a.cliente,
    importe_xubio: Math.round(a.importeXubio),
    importe_app: Math.round(a.importeApp),
    fecha_ajuste: fechaArgentinaHoy(),
    motivo: a.motivo,
    usuario: a.usuario,
    estado: 'activo',
  };
  const actualizada = await updateRow(HOJA_AJUSTES, 'numero', fila.numero, fila);
  if (!actualizada) await appendRowObj(HOJA_AJUSTES, fila);
}
