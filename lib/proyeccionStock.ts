import type { Lote, VentaDia, Variedad } from './types';
import { proyeccionCosechaSemanal } from './estadisticas';
import { GR_PAQ_RUCULA, GR_PAQ_LECHUGA } from './estadisticasVentas';

// ── Vamos a estar largos o cortos la semana que viene ─────────────────────────────────
//
// La pantalla de Stocks dice lo que hay HOY. Lo que JP necesita saber es otra cosa: si lo
// que va a salir de las naves la semana que viene se va a poder vender. Si se cosecha un 40%
// más de lo que se vende, la diferencia termina en la cámara y de ahí a la basura — y cuando
// se ve el stock acumulado ya es tarde para hacer algo: la planta ya está en el tubo.
//
// Son dos estimaciones y ninguna es un dato:
//
// · LA VENTA es el promedio de las dos últimas semanas completas. Dos y no cuatro porque el
//   negocio se mueve rápido y un mes atrás ya no describe la demanda de ahora; dos y no una
//   porque una sola semana con un feriado o un pedido grande de La Gallega manda cualquiera.
//
// · LA COSECHA sale de la misma proyección que usa el panel, que estima por lote con el
//   ciclo real de cada variedad.
//
// Se informan las dos por separado y no solo la diferencia: una diferencia de 2.000 unidades
// significa algo muy distinto si se venden 3.000 o si se venden 20.000.

export type CultivoProy = 'rucula' | 'lechuga' | 'albahaca';

export interface ComparacionCultivo {
  cultivo: CultivoProy;
  label: string;
  // Promedio semanal de las dos últimas semanas completas, en unidades/paquetes.
  ventaPromedio: number;
  // Las dos semanas por separado, para poder desconfiar del promedio cuando son muy
  // distintas entre sí: promediar 1.000 y 9.000 da 5.000, que no pasó nunca.
  ventaSemanas: { label: string; unidades: number }[];
  cosechaProyectada: number;
  diferencia: number;        // cosecha − venta: positivo = sobra
  pct: number | null;        // la diferencia sobre la venta
}

export interface ProyeccionSemana {
  semanaLabel: string;
  desdeVenta: string;
  hastaVenta: string;
  cultivos: ComparacionCultivo[];
  // Sin ventas de las dos semanas no hay con qué comparar, y una comparación contra cero
  // diría que sobra todo.
  hayVentas: boolean;
}

const LABEL: Record<CultivoProy, string> = { rucula: 'Rúcula', lechuga: 'Lechuga', albahaca: 'Albahaca' };

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

function lunesDe(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const masDias = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const dm = (f: string) => { const [, m, d] = f.split('-'); return `${d}/${m}`; };

// Las unidades de un cultivo en una fila de venta, con los kilos convertidos a paquetes con
// el mismo gramaje que usa el resto de la app. Sin convertirlos, un cliente que compra por
// kilo no contaría como demanda y la cosecha parecería sobrar.
function unidadesDe(v: VentaDia, cultivo: CultivoProy): number {
  if (cultivo === 'rucula') {
    return num(v.rucula) + (num(v.rucula_kg) * 1000) / GR_PAQ_RUCULA;
  }
  if (cultivo === 'lechuga') {
    const kg = num(v.lechuga_kg) + num(v.lechuga_kg_crespa) + num(v.lechuga_kg_roble);
    return num(v.lechuga_crespa) + num(v.hoja_roble) + (kg * 1000) / GR_PAQ_LECHUGA;
  }
  return num(v.albahaca);
}

export function proyeccionSemanaQueViene(
  ventas: VentaDia[], lotes: Lote[], variedades: Variedad[], hoy: Date = new Date(),
): ProyeccionSemana {
  // Las dos últimas semanas COMPLETAS: la que está corriendo no sirve de referencia, porque
  // al martes lleva dos días de venta y parecería que se desplomó la demanda.
  const lunesEstaSemana = lunesDe(hoy);
  const semanas = [
    { desde: masDias(lunesEstaSemana, -14), hasta: masDias(lunesEstaSemana, -8) },
    { desde: masDias(lunesEstaSemana, -7), hasta: masDias(lunesEstaSemana, -1) },
  ].map((s) => ({ desde: iso(s.desde), hasta: iso(s.hasta) }));

  // La proyección de cosecha por semana, empezando por la semana en curso. El índice 1 es la
  // que viene.
  const puntos = proyeccionCosechaSemanal(lotes, variedades, 3, 7);
  const proxima = puntos[1] || { rucula: 0, lechuga: 0, albahaca: 0, label: '' };

  const cultivos: CultivoProy[] = ['rucula', 'lechuga', 'albahaca'];
  let totalVendido = 0;

  const comparaciones = cultivos.map((cultivo) => {
    const porSemana = semanas.map((s) => {
      const u = ventas
        .filter((v) => { const f = soloFecha(v.fecha); return f >= s.desde && f <= s.hasta; })
        .reduce((a, v) => a + unidadesDe(v, cultivo), 0);
      return { label: `${dm(s.desde)}–${dm(s.hasta)}`, unidades: Math.round(u) };
    });
    const ventaPromedio = Math.round(porSemana.reduce((a, s) => a + s.unidades, 0) / (porSemana.length || 1));
    totalVendido += ventaPromedio;
    const cosechaProyectada = Math.round(num((proxima as any)[cultivo]));
    const diferencia = cosechaProyectada - ventaPromedio;
    return {
      cultivo, label: LABEL[cultivo],
      ventaPromedio, ventaSemanas: porSemana,
      cosechaProyectada, diferencia,
      pct: ventaPromedio > 0 ? Math.round((diferencia / ventaPromedio) * 100) : null,
    };
  });

  const lunesProxima = masDias(lunesEstaSemana, 7);
  return {
    semanaLabel: `${dm(iso(lunesProxima))} al ${dm(iso(masDias(lunesProxima, 6)))}`,
    desdeVenta: semanas[0].desde,
    hastaVenta: semanas[1].hasta,
    cultivos: comparaciones,
    hayVentas: totalVendido > 0,
  };
}
