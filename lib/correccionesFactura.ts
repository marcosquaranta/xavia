// ── Cuánto hay que cobrar de una factura ya emitida ──────────────────────────────────
//
// Una factura emitida se corrige de tres formas y todas terminan cambiando lo que hay que
// cobrar, pero solo una de ellas cambiaba el número que mostraban las pantallas:
//
//  1. AJUSTE del lado de la app — la factura sigue diciendo lo que dice y la app reclama
//     otra cosa. Esto ya se aplicaba en todos lados (ver ajusteFactura.ts).
//
//  2. NOTA DE CRÉDITO en Xubio — la corrección de verdad, y desde hace poco la normal: al
//     corregir cantidades en el historial sale sola. Acá estaba el agujero. La NC baja la
//     deuda en Xubio, y el ajuste se revierte a propósito para no restar dos veces… pero
//     ninguna pantalla restaba la NC. Resultado: se corregía una factura, se emitía la NC,
//     y la lista de facturas del cliente seguía mostrando el importe original. El que la
//     corrigió lo único que veía era que no había pasado nada.
//
//  3. FACTURA EXTRA por la diferencia, cuando la corrección suma. Esa no toca a la factura
//     original: es un comprobante nuevo y aparece sola en la lista, como corresponde.
//
// Esto junta 1 y 2 en una sola respuesta, para que todas las pantallas que preguntan
// "cuánto vale esta factura" reciban lo mismo. Son siete lugares —la lista de facturas, el
// libro mayor, la pantalla de Cobranzas, los recordatorios, el saldado de antiguas, el
// asistente— y antes de esto cada uno sabía de los ajustes y ninguno de las notas.
//
// Por qué sale de la hoja de la app y no de los comprobantes de Xubio: la NC emitida hoy no
// está en la foto de Xubio hasta mañana a la mañana. Corregir una factura y tener que
// esperar al día siguiente para ver el efecto es la misma espera que esto viene a sacar.

import { claveComprobante } from './comprobantes';
import { type AjusteAplicado } from './ajusteFactura';
import { type NotaCreditoRegistrada } from './notaCredito';

export interface CorreccionFactura {
  // Lo que la app reclama en vez de lo emitido, cuando hay un ajuste a mano. Sin ajuste
  // queda undefined y manda el importe de Xubio menos lo acreditado.
  importeApp?: number;
  // Lo que se le acreditó al cliente con notas de crédito sobre ESTA factura.
  creditado: number;
  notas: { numero: string; importe: number; fecha: string }[];
  motivo: string;
  fecha: string;
}

// Las NC emitidas desde la app, agrupadas por la factura que acreditan.
//
// Solo las 'emitida': una anulada no acreditó nada, y restarla haría que la factura figure
// cobrada por una plata que el cliente nunca dejó de deber.
export function notasPorFactura(
  filas: NotaCreditoRegistrada[],
  // Claves de NC que el que llama YA está restando por su cuenta, porque le llegaron entre
  // los comprobantes de Xubio. Sin esto, la misma NC se restaría dos veces el día que entra
  // a la foto de Xubio: una por el comprobante y otra por el registro de la app. Las
  // pantallas que no miran las NC de Xubio no pasan nada y se restan todas.
  yaRestadas?: Set<string>,
): Map<string, NotaCreditoRegistrada[]> {
  const out = new Map<string, NotaCreditoRegistrada[]>();
  for (const f of filas || []) {
    const estado = String(f?.estado || '').trim();
    if (estado && estado !== 'emitida') continue;
    if (yaRestadas?.has(claveComprobante(f?.numero_nc))) continue;
    const k = claveComprobante(f?.numero_factura);
    if (!k) continue;
    const l = out.get(k) || [];
    l.push(f);
    out.set(k, l);
  }
  return out;
}

// Ajustes y notas en una sola respuesta por factura.
export function correccionesPorFactura(
  ajustes: Map<string, AjusteAplicado>,
  notas: NotaCreditoRegistrada[],
  yaRestadas?: Set<string>,
): Map<string, CorreccionFactura> {
  const porNota = notasPorFactura(notas, yaRestadas);
  const out = new Map<string, CorreccionFactura>();

  for (const [k, a] of ajustes) {
    out.set(k, { importeApp: a.importeApp, creditado: 0, notas: [], motivo: a.motivo, fecha: a.fecha });
  }

  for (const [k, lista] of porNota) {
    const previa = out.get(k);
    const creditado = lista.reduce((s, n) => s + (Math.round(Number(n.importe)) || 0), 0);
    const detalle = lista.map((n) => ({
      numero: String(n.numero_nc || ''),
      importe: Math.round(Number(n.importe)) || 0,
      fecha: String(n.fecha || '').split(/[T ]/)[0],
    }));
    // Ajuste Y nota sobre la misma factura no debería pasar: al emitir la NC el ajuste se
    // revierte. Si igual aparecen los dos, manda la NC —es la que de verdad movió plata en
    // Xubio— y el ajuste se descarta en vez de sumarse, que restaría dos veces lo mismo.
    out.set(k, {
      creditado,
      notas: detalle,
      motivo: previa?.motivo || '',
      fecha: detalle[detalle.length - 1]?.fecha || previa?.fecha || '',
    });
  }

  return out;
}

// Lo que hay que cobrar de una factura, dado lo que dice el comprobante.
//
// Nunca baja de cero: una NC por más que la factura dejaría a la factura "cobrando" en
// negativo y tapando otras facturas abiertas al repartir los cobros.
export function importeAReclamar(importeXubio: number, c?: CorreccionFactura): number {
  if (!c) return importeXubio;
  if (c.importeApp !== undefined) return c.importeApp;
  return Math.max(0, Math.round(importeXubio) - c.creditado);
}

// Si esta factura está corregida, y cómo. Para poder decirlo en pantalla: un importe que no
// coincide con el comprobante y no explica por qué manda a buscar un error que no existe.
export function explicarCorreccion(importeXubio: number, c?: CorreccionFactura): string {
  if (!c) return '';
  if (c.importeApp !== undefined) {
    return `Corregida en la app: el comprobante dice $${Math.round(importeXubio).toLocaleString('es-AR')}`
      + `${c.motivo ? ` — ${c.motivo}` : ''}. En Xubio sigue como está.`;
  }
  if (c.creditado > 0) {
    const nums = c.notas.map((n) => n.numero).filter(Boolean).join(', ');
    return `Se le acreditaron $${c.creditado.toLocaleString('es-AR')} con ${c.notas.length === 1 ? 'la nota de crédito' : 'las notas de crédito'} `
      + `${nums || '(sin número)'}. El comprobante original sigue diciendo $${Math.round(importeXubio).toLocaleString('es-AR')}.`;
  }
  return '';
}
