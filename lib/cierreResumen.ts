import type { EERR } from './eerr';
import type { SaldoMes } from './cuentas';
import type { OrigenAplicacion } from './origenAplicacion';
import type { PasoCierre } from './cierreChecklist';

// ── Los cuatro puntos del cierre ──────────────────────────────────────────────────────
//
// La pantalla del cierre tiene todo, y eso es justamente el problema: el checklist, la
// tabla, el puente de caja, los saldos, las previsiones. Entrar y saber si el mes está bien
// exige leerla entera, y nadie la lee entera todos los meses.
//
// Esto es la respuesta en cuatro renglones, arriba de todo. Son las cuatro preguntas en el
// orden en que conviene hacerlas, y están en este orden por una razón: cada una vuelve
// irrelevante a la siguiente si da mal. Mirar el resultado antes de saber si el stock está
// contado es mirar un número inventado.
//
//   1. ¿Cuánto dio?          — el número del mes y contra qué se compara.
//   2. ¿Son datos reales?    — el stock contado y los insumos aplicados: si faltan, el costo
//                              variable es ficción y el resultado de arriba no vale nada.
//   3. ¿Cierra con el banco? — si los saldos no dan, hay plata que se movió sin registrarse,
//                              y entonces falta un gasto o un cobro en algún lado.
//   4. ¿Dónde quedó?         — ganar y que la caja baje es normal (se cobra tarde, se compra
//                              stock), pero hay que saber cuánto de la diferencia no se
//                              explica.
//
// Cada punto es UNA línea. No es una restricción estética: en cuatro líneas se leen las
// cuatro, y la quinta línea es la que hace que no se lea ninguna.

export type TonoPunto = 'ok' | 'atencion' | 'problema' | 'neutro';

export interface PuntoCierre {
  // Qué se está contestando, en dos o tres palabras.
  clave: string;
  // La respuesta, en una línea. Tiene que poder leerse sola, sin mirar nada más.
  texto: string;
  tono: TonoPunto;
  href?: string;
}

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

export function puntosDelCierre(args: {
  act: EERR;
  ant: EERR;
  pasos: PasoCierre[];
  saldos: SaldoMes[];
  fondos: OrigenAplicacion;
  anio: number;
  mes: number;
  nombreMes: string;
  nombreMesPrev: string;
  esMesActual: boolean;
}): PuntoCierre[] {
  const { act, ant, pasos, saldos, fondos, anio, mes, nombreMes, nombreMesPrev, esMesActual } = args;
  const estado = (id: string) => pasos.find((p) => p.id === id)?.estado;
  const puntos: PuntoCierre[] = [];

  // ── 1. Cuánto dio ──────────────────────────────────────────────────────────────────
  //
  // Se compara contra el mes anterior y no contra un objetivo porque no hay objetivo
  // cargado: inventar uno haría que el renglón diga "está mal" o "está bien" sin que nadie
  // haya decidido respecto de qué.
  const difRes = Math.round(act.resultado - ant.resultado);
  const hayAnterior = !!(ant.ventas.total || ant.costosFijos.total);
  const margen = act.ventas.total > 0 ? (act.resultado / act.ventas.total) * 100 : null;
  puntos.push({
    clave: 'Resultado',
    texto: act.ventas.total === 0
      ? `${nombreMes} todavía no tiene ventas cargadas: no hay resultado que mirar.`
      : `${nombreMes} dio ${$(act.resultado)}${margen !== null ? ` (${Math.round(margen)}% de ${$(act.ventas.total)} de venta)` : ''}`
        + (hayAnterior
          ? `, ${difRes >= 0 ? 'arriba' : 'abajo'} de ${nombreMesPrev} por ${$(Math.abs(difRes))}.`
          : '.')
      ,
    tono: act.ventas.total === 0 ? 'neutro' : act.resultado < 0 ? 'problema' : hayAnterior && difRes < 0 ? 'atencion' : 'ok',
  });

  // ── 2. Si los datos del costo están ────────────────────────────────────────────────
  //
  // Los dos pasos que, faltando, hacen que el resultado de arriba sea un número inventado:
  // sin stock final contado el consumo da igual a todo el stock inicial, y un insumo
  // comprado sin aplicar a stock no entra al costo por ningún lado.
  const stockListo = estado('stock_final') === 'listo';
  const insumos = estado('insumos_stock');
  puntos.push({
    clave: 'Datos del costo',
    texto: !stockListo
      ? 'Falta contar el stock final: hasta que esté, el costo variable y el resultado de arriba no son reales.'
      : insumos === 'pendiente'
        ? 'El stock está contado, pero quedan compras de insumos sin aplicar a Stocks: ese costo no está en ningún lado.'
        : 'El stock final está contado y las compras de insumos están aplicadas: el costo variable es real.',
    tono: !stockListo ? 'problema' : insumos === 'pendiente' ? 'atencion' : 'ok',
    href: '/stocks',
  });

  // ── 3. Si cierra contra el banco ───────────────────────────────────────────────────
  //
  // Una diferencia acá no es un error de la app: es plata que se movió sin que quede
  // registrada. Y mientras exista, cualquier línea del resultado puede ser la que falta.
  const sinReal = saldos.filter((s) => s.real === null).length;
  const conDif = saldos.filter((s) => s.diferencia !== null && Math.abs(s.diferencia) >= 1);
  const totalDif = conDif.reduce((a, s) => a + Math.abs(s.diferencia || 0), 0);
  puntos.push({
    clave: 'Contra el banco',
    texto: sinReal === saldos.length
      ? 'No hay ningún saldo de resumen cargado: todavía no se puede saber si lo registrado coincide con el banco.'
      : sinReal > 0
        ? `Faltan los saldos de ${sinReal} ${sinReal === 1 ? 'cuenta' : 'cuentas'} para poder conciliar${conDif.length ? `, y ${conDif.length} ya ${conDif.length === 1 ? 'da' : 'dan'} diferencia` : ''}.`
        : conDif.length > 0
          ? `${conDif.length} ${conDif.length === 1 ? 'cuenta' : 'cuentas'} ${conDif.length === 1 ? 'no cierra' : 'no cierran'} contra el resumen por ${$(totalDif)} (${conDif.map((s) => s.medio).join(', ')}): hay plata que se movió sin registrarse.`
          : 'Todas las cuentas cierran contra el resumen del banco: no falta ningún movimiento.',
    tono: sinReal > 0 ? 'atencion' : conDif.length > 0 ? 'problema' : 'ok',
    href: `/eerr?anio=${anio}&mes=${mes}#cuentas`,
  });

  // ── 4. Dónde quedó la plata ────────────────────────────────────────────────────────
  //
  // Ganar y que la caja baje es normal —se cobra tarde, se compra stock, se paga deuda
  // vieja— y el puente lo explica línea por línea. Lo que importa en un renglón es cuánto
  // de la diferencia NO se explica, porque eso sí es un dato que falta.
  const sinExplicar = fondos.sinExplicar;
  const deltaCaja = fondos.cajaReal !== null ? Math.round(fondos.cajaReal) : null;
  puntos.push({
    clave: 'Resultado vs caja',
    texto: sinExplicar === null
      ? 'El puente entre el resultado y la caja necesita los saldos reales cargados para poder cerrarse.'
      : Math.abs(sinExplicar) < 1
        ? `El resultado explica entero el movimiento de caja del mes${deltaCaja !== null ? ` (${$(deltaCaja)})` : ''}: no queda nada sin explicar.`
        : `Quedan ${$(Math.abs(sinExplicar))} de movimiento de caja sin explicar por el resultado: falta cargar algún gasto, cobro o transferencia.`,
    tono: sinExplicar === null ? 'atencion' : Math.abs(sinExplicar) < 1 ? 'ok' : 'problema',
    href: `/eerr?anio=${anio}&mes=${mes}#fondos`,
  });

  // El mes en curso no es un cierre: casi todo va a dar mal y eso no quiere decir nada. Se
  // avisa una vez en vez de pintar los cuatro renglones de rojo.
  if (esMesActual) {
    return puntos.map((p) => ({ ...p, tono: p.tono === 'problema' ? 'atencion' : p.tono }));
  }
  return puntos;
}
