// ── Ensaladas vendidas por mes ───────────────────────────────────────────────────────
//
// Lo pidió Fran, y la razón importa más que el número: con la cantidad vendida por mes a la
// vista puede presionar a Producción y a Ventas para que el producto fluya. Un número que
// nadie mira no mueve a nadie; uno que está en la home de todos los días, sí.
//
// Por eso es UN número por mes y no un tablero: cuántas ensaladas se vendieron. Partido por
// tipo, porque "ensaladas" en general no dice si lo que no se mueve es la clásica o la de
// parmesano, y eso cambia a quién hay que ir a buscar.
//
// Cuáles son "ensaladas" no se escribe acá: salen de `seccionAparte` en el catálogo, que es
// la misma marca con la que la pantalla de carga les da su propia sección. Si mañana se
// agrega otra ensalada, entra sola — que es exactamente el error que ya se pagó caro con
// las listas de artículos escritas a mano en cada cálculo.

import { ARTICULOS } from './articulos';
import type { VentaDia } from './types';

export interface TipoEnsalada { key: string; label: string; color: string }

export function tiposDeEnsalada(): TipoEnsalada[] {
  return ARTICULOS
    .filter((a) => a.seccionAparte)
    .map((a) => ({ key: a.key, label: a.label, color: a.color || '#0f766e' }));
}

export interface PuntoEnsaladas {
  mes: string;        // YYYY-MM
  label: string;      // "nov 26"
  total: number;
  // Cantidad por tipo, con la clave del artículo.
  porTipo: Record<string, number>;
  // Cuántos clientes distintos compraron ensaladas ese mes. Un mes que crece porque un
  // cliente pidió el doble no es lo mismo que uno que crece porque entraron tres clientes
  // nuevos, y para presionar a Ventas la diferencia es toda.
  clientes: number;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const mesDe = (f: any) => String(f || '').split(/[T ]/)[0].slice(0, 7);

export function evolucionEnsaladas(
  ventas: VentaDia[], n = 12, fechaRef: Date = new Date(),
): PuntoEnsaladas[] {
  const tipos = tiposDeEnsalada();
  const meses: PuntoEnsaladas[] = [];
  const idx = new Map<string, number>();

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(fechaRef.getFullYear(), fechaRef.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    idx.set(mes, meses.length);
    meses.push({
      mes,
      label: `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      total: 0,
      porTipo: Object.fromEntries(tipos.map((t) => [t.key, 0])),
      clientes: 0,
    });
  }

  // Los clientes se cuentan por mes y sin repetir: un cliente que compró cuatro veces es
  // uno, no cuatro.
  const clientesPorMes = meses.map(() => new Set<string>());

  for (const v of ventas || []) {
    const mes = mesDe(v.fecha);
    const i = idx.get(mes);
    if (i === undefined) continue;
    let algo = 0;
    for (const t of tipos) {
      const q = Number((v as any)[t.key]) || 0;
      if (q <= 0) continue;
      meses[i].porTipo[t.key] += q;
      algo += q;
    }
    if (algo > 0) {
      meses[i].total += algo;
      const cli = String(v.id_control || v.nombre_cliente || '').trim();
      if (cli) clientesPorMes[i].add(cli);
    }
  }

  meses.forEach((m, i) => { m.clientes = clientesPorMes[i].size; });
  return meses;
}

export interface ResumenEnsaladas {
  mesActual: PuntoEnsaladas | null;
  mesAnterior: PuntoEnsaladas | null;
  // Variación contra el mes anterior, en unidades y en %. null cuando no hay con qué
  // comparar — un primer mes no "creció infinito".
  diferencia: number | null;
  variacionPct: number | null;
  // El mejor mes de la serie, para que el número de hoy tenga una vara.
  mejor: PuntoEnsaladas | null;
}

export function resumenEnsaladas(serie: PuntoEnsaladas[]): ResumenEnsaladas {
  if (!serie.length) return { mesActual: null, mesAnterior: null, diferencia: null, variacionPct: null, mejor: null };
  const mesActual = serie[serie.length - 1];
  const mesAnterior = serie.length > 1 ? serie[serie.length - 2] : null;
  const diferencia = mesAnterior ? mesActual.total - mesAnterior.total : null;
  const variacionPct = mesAnterior && mesAnterior.total > 0
    ? Math.round(((mesActual.total - mesAnterior.total) / mesAnterior.total) * 1000) / 10
    : null;
  const mejor = serie.reduce((a, m) => (!a || m.total > a.total ? m : a), null as PuntoEnsaladas | null);
  return { mesActual, mesAnterior, diferencia, variacionPct, mejor };
}
