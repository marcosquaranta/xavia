// ── Facturas comprometidas: avisadas pero todavía no imputadas ───────────────────────
//
// Hay un estado intermedio que la app no tenía nombre para decir. Una factura puede estar:
//
//   impaga      — nadie dijo nada, se reclama
//   cobrada     — la plata entró y está imputada a una cuenta
//   COMPROMETIDA — el cliente avisó que la paga, con fecha y número de factura, y el aviso
//                  está en la bandeja esperando que alguien lo confirme
//
// Lo tercero se trataba como lo primero, y por eso el reclamo del lunes salía igual: le
// pedíamos a un cliente una factura que nos acababa de avisar que estaba pagando. El dato
// estaba en la app —en la bandeja, con el número de factura y todo— y los reclamos no lo
// miraban.
//
// El caso que lo vuelve necesario de verdad es La Esperanza: avisan el pago, pero pagan en
// persona y la plata entra a la caja de alguno de los cuatro socios. No hay transferencia
// que conciliar, así que ese aviso puede quedarse semanas en la bandeja sin que nadie lo
// impute, y mientras tanto la factura no debería reclamarse. Pero tampoco puede
// desaparecer: lo que queda pendiente no es el cobro, es SABER A DÓNDE FUE LA PLATA.
//
// De ahí las dos salidas de este archivo: las que cubren (para sacarlas del reclamo) y las
// que ya se pasaron de fecha (para que alguien las vea). Nunca una sin la otra — una
// factura que deja de reclamarse en silencio es peor que una reclamada de más, porque la
// de más el cliente la contesta y la otra no la ve nadie.

import type { ItemBandeja } from './bandejaCobranzas';

// Cuántos días después de la fecha prometida se la sigue considerando cubierta. El aviso
// dice "pago el 15"; el 15 la plata puede tardar en acreditar, o el cheque en depositarse,
// y reclamar el 16 sería ridículo. Pasado eso, el compromiso dejó de cumplirse en tiempo y
// vuelve a ser una factura impaga como cualquier otra — además de salir en la alerta.
export const DIAS_GRACIA_COMPROMISO = 7;

export interface FacturaComprometida {
  numero: string;        // la clave normalizada del comprobante
  idItem: string;        // la fila de la bandeja que la compromete
  cliente: string;
  fechaAviso: string;    // la fecha que el aviso declara para el pago
  importe: number;       // el del aviso completo, no el de esta factura sola
  dias: number;          // cuántos pasaron desde esa fecha (negativo = todavía no llegó)
  vencida: boolean;      // se pasó de la gracia: deja de cubrir y hay que mirarla
}

const diasEntre = (desde: string, hasta: string) => {
  const a = Date.parse(`${desde}T12:00:00Z`), b = Date.parse(`${hasta}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
};

// `clave` se recibe en vez de importarse para no atar este archivo a la forma en que cada
// pantalla normaliza un número de comprobante: la única regla que importa es que el que
// pregunta y el que responde usen la misma, y eso se garantiza pasándola.
export function comprometidasDeBandeja(
  items: ItemBandeja[],
  hoy: string,
  clave: (numero: string) => string,
  graciaDias = DIAS_GRACIA_COMPROMISO,
): { cubiertas: Map<string, FacturaComprometida>; vencidas: FacturaComprometida[]; sinImputar: FacturaComprometida[] } {
  const cubiertas = new Map<string, FacturaComprometida>();
  const vencidas: FacturaComprometida[] = [];
  const sinImputar: FacturaComprometida[] = [];

  for (const it of items || []) {
    // Solo lo que sigue esperando. Confirmado ya es un cobro de verdad y descartado es una
    // fila que alguien miró y decidió que no era un cobro: ninguno de los dos compromete.
    if (String(it?.estado || '') !== 'pendiente') continue;
    const numeros = String(it?.comprobantes || '').split(',').map(n => clave(n.trim())).filter(Boolean);
    // Sin número de factura no hay nada que cubrir: un aviso que no dice qué paga no puede
    // sacar del reclamo a ninguna factura en particular. Queda para que lo resuelva una
    // persona en la bandeja, como hasta ahora.
    if (!numeros.length) continue;

    const fechaAviso = String(it?.fecha || '').split(/[T ]/)[0];
    const dias = fechaAviso ? diasEntre(fechaAviso, hoy) : 0;
    const vencida = dias > graciaDias;

    for (const numero of numeros) {
      const f: FacturaComprometida = {
        numero, idItem: String(it?.id_item || ''), cliente: String(it?.cliente || '').trim() || 'sin reconocer',
        fechaAviso, importe: Number(it?.importe) || 0, dias, vencida,
      };
      sinImputar.push(f);
      if (vencida) vencidas.push(f);
      else cubiertas.set(numero, f);
    }
  }
  return { cubiertas, vencidas, sinImputar };
}
