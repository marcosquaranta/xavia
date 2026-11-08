// ── Lo que hay que mirar antes de cargar la venta del día ────────────────────────────
//
// Tres cosas que ya existían pero vivían cada una en su pantalla: los cajones que no
// vuelven (en Cajones), lo que se cargó y nunca se facturó (en el historial de facturación)
// y los clientes que dejaron de pedir (solo en un mail que sale los lunes y jueves).
//
// El problema no era que faltara el dato, era dónde estaba. Las tres se resuelven desde
// Ventas y ninguna se veía desde Ventas: para enterarte tenías que entrar a buscarlas
// sabiendo que existían. Un aviso que hay que ir a buscar no es un aviso.
//
// Acá se arman juntas, con el mismo cálculo que usa cada pantalla original —se importa, no
// se recalcula— para que el número de la alerta y el de la pantalla no puedan discrepar.

import type { VentaDia, ClienteVenta } from './types';
import { PROD_KEYS } from './articulos';
import { diasEntreISO } from './historialVentas';

export interface AlertaVenta {
  tipo: 'error' | 'warn' | 'info';
  titulo: string;
  detalle?: string;
  href?: string;
  verTexto?: string;
}

// Más de esto sin facturar deja de ser "todavía no lo mandé" y pasa a ser algo olvidado.
// Dos días cubre el caso normal —se carga a la tarde y se factura al otro día— sin avisar
// de la venta de hoy, que todavía no tiene por qué estar facturada.
export const DIAS_SIN_FACTURAR = 2;

// ── Hasta cuántos días atrás avisa el MAIL ─────────────────────────────────────────
//
// Decisión de Marcos: una venta sin facturar se arregla el día después, o ya no se
// arregla. Pasados tres días el aviso deja de ser una tarea y pasa a ser un recordatorio
// de algo que ya no tiene vuelta — y un mail que repite todos los días las mismas seis
// ventas viejas deja de abrirse, con lo cual la de ayer tampoco se ve.
//
// Las viejas NO desaparecen: siguen en la pantalla de Ventas y en el historial, que es
// donde se las mira cuando uno decide ponerse con eso. Lo que cambia es que no interrumpen
// todos los días.
export const DIAS_MAX_AVISO_MAIL = 3;

// Las que entran en el mail: lo bastante viejas para que facturarlas ya debería haber
// pasado, y lo bastante nuevas para que todavía se pueda hacer algo.
export function paraElMail(
  lista: { dias: number }[], diasMin = DIAS_SIN_FACTURAR, diasMax = DIAS_MAX_AVISO_MAIL,
): typeof lista {
  return lista.filter((x) => x.dias >= diasMin && x.dias <= diasMax);
}

export interface PendienteSinFacturar {
  fecha: string;
  id_control: string;
  cliente: string;
  dias: number;
  // Si ese mismo día salió factura a ese cliente, lo más probable es que esta carga esté
  // repetida y haya que borrarla, no facturarla.
  huboFacturaEseDia: boolean;
}

const soloDia = (f: any) => String(f || '').split(/[T ]/)[0];
// Los artículos de la hoja NO se adivinan por el nombre de la columna: llegan en
// `clavesExtra`, leídas del catálogo. Un regex tipo /^microgreen/ sería una segunda forma de
// decidir qué es un artículo, y el día que alguien dé de alta uno con otro nombre esta
// alerta lo ignoraría sin que nada falle.
const tieneCantidad = (v: any) => PROD_KEYS.some((k) => (Number(v?.[k]) || 0) > 0);

// ── Ventas cargadas que nunca se facturaron ─────────────────────────────────────────
//
// `clavesExtra` llega del catálogo para que una venta de un artículo dado de alta desde la
// app también cuente. Sin eso, lo que no está escrito en el código es invisible acá, que es
// justo el error que se arrastraba en el historial.
export function ventasSinFacturar(
  ventas: VentaDia[], clientes: ClienteVenta[], hoyStr: string,
  clavesExtra: string[] = [], diasMinimo = DIAS_SIN_FACTURAR,
): PendienteSinFacturar[] {
  const nombres = new Map(clientes.map((c) => [String(c.id_control), String(c.nombre_display || c.nombre_xubio || c.id_control)]));
  const conCantidad = (v: any) => tieneCantidad(v) || clavesExtra.some((k) => (Number(v?.[k]) || 0) > 0);

  // Qué clientes SÍ tuvieron factura cada día: es lo que distingue "falta facturar" de
  // "esta fila está cargada dos veces".
  const facturadoEseDia = new Set<string>();
  for (const v of ventas) {
    if (!String(v.exportado || '').trim()) continue;
    facturadoEseDia.add(`${soloDia(v.fecha)}__${v.id_control}`);
  }

  const porClienteFecha = new Map<string, PendienteSinFacturar>();
  for (const v of ventas) {
    if (String(v.exportado || '').trim()) continue;
    if (!conCantidad(v)) continue;
    const fecha = soloDia(v.fecha);
    if (!fecha || fecha > hoyStr) continue;
    const dias = diasEntreISO(fecha, hoyStr);
    if (dias < diasMinimo) continue;
    const key = `${fecha}__${v.id_control}`;
    if (porClienteFecha.has(key)) continue;
    porClienteFecha.set(key, {
      fecha,
      id_control: String(v.id_control),
      cliente: nombres.get(String(v.id_control)) || String(v.id_control),
      dias,
      huboFacturaEseDia: facturadoEseDia.has(key),
    });
  }

  return [...porClienteFecha.values()].sort((a, b) => b.dias - a.dias || a.cliente.localeCompare(b.cliente));
}
