// ── Cuánto se sigue haciendo fuera de la app ─────────────────────────────────────────
//
// El objetivo es que Xubio sea solo el lugar donde se emite la factura, y que todo lo demás
// se vea y se cargue en la app. Eso no se logra escribiendo código: se logra cuando TODA
// factura se emite desde la app y TODO cobro se registra desde la app. Mientras una factura
// se cargue a mano en Xubio, la app no la tiene y hay que ir a buscarla allá.
//
// Esto lo mide. Es el indicador que dice si la independencia es real o es una intención:
// mientras haya comprobantes o cobranzas que la app no originó, el cierre sigue dependiendo
// de Xubio, por más pantallas que se agreguen de este lado.

import { claveComprobante } from './comprobantes';

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

export interface Dependencia {
  totalComprobantes: number;
  comprobantesDeLaApp: number;
  comprobantesAjenos: { numero: string; fecha: string; cliente: string; importe: number }[];
  totalCobranzas: number;
  cobranzasDeLaApp: number;
  cobranzasAjenas: { numero: string; fecha: string; cliente: string; importe: number }[];
}

export function medirDependencia(args: {
  comprobantes: any[];
  cobranzas: any[];
  // Números de comprobante que la app emitió (columna `exportado` de Ventas).
  emitidosPorLaApp: Iterable<any>;
  // Números de recibo que la app registró (columna `numero_recibo` de CobrosRegistrados).
  recibosDeLaApp: Iterable<any>;
  desde: string;
  hasta: string;
}): Dependencia {
  const emitidos = new Set<string>();
  for (const n of args.emitidosPorLaApp) {
    const k = claveComprobante(n);
    if (k) emitidos.add(k);
  }
  const recibos = new Set<string>();
  for (const n of args.recibosDeLaApp) {
    const k = claveComprobante(n);
    if (k) recibos.add(k);
  }

  const enRango = (f: any) => {
    const d = soloFecha(f);
    return !!d && d >= args.desde && d <= args.hasta;
  };
  const nombre = (c: any) => {
    const cl = c?.cliente;
    return String(typeof cl === 'string' ? cl : (cl?.nombre || '')).trim();
  };

  const comprobantesAjenos: Dependencia['comprobantesAjenos'] = [];
  let totalComprobantes = 0;
  for (const c of args.comprobantes || []) {
    // Solo facturas: una nota de crédito nunca se emite desde la app, así que contarla como
    // "ajena" diría que hay un problema de hábito donde hay una función que falta.
    if (Number(c?.tipo) !== 1) continue;
    if (!enRango(c?.fecha)) continue;
    totalComprobantes++;
    const numero = String(c?.numeroDocumento || '').trim();
    if (emitidos.has(claveComprobante(numero))) continue;
    comprobantesAjenos.push({
      numero, fecha: soloFecha(c?.fecha), cliente: nombre(c), importe: Number(c?.importetotal) || 0,
    });
  }

  const cobranzasAjenas: Dependencia['cobranzasAjenas'] = [];
  let totalCobranzas = 0;
  for (const c of args.cobranzas || []) {
    if (!enRango(c?.fecha)) continue;
    totalCobranzas++;
    const numero = String(c?.numeroDocumento || '').trim();
    if (numero && recibos.has(claveComprobante(numero))) continue;
    const items = c?.transaccionInstrumentoDeCobro;
    const importe = Array.isArray(items) ? items.reduce((a: number, i: any) => a + (Number(i?.importe) || 0), 0) : 0;
    cobranzasAjenas.push({ numero, fecha: soloFecha(c?.fecha), cliente: nombre(c), importe });
  }

  return {
    totalComprobantes,
    comprobantesDeLaApp: totalComprobantes - comprobantesAjenos.length,
    comprobantesAjenos: comprobantesAjenos.sort((a, b) => b.importe - a.importe),
    totalCobranzas,
    cobranzasDeLaApp: totalCobranzas - cobranzasAjenas.length,
    cobranzasAjenas: cobranzasAjenas.sort((a, b) => b.importe - a.importe),
  };
}
