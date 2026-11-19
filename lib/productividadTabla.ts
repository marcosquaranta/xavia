// ── Productividad: cosecha + trasplante contra horas, mes a mes ──────────────────────
//
// Reemplaza al gráfico de "plantas cosechadas por hora-persona", que no servía por tres
// motivos y el tercero es el que importa:
//
//  1. Doce meses de ventana con cuatro meses de datos. La caché de fichajes arrancó en
//     agosto de 2026, así que dos tercios del gráfico eran aire y se leía como roto.
//
//  2. El mes en curso se comparaba contra meses enteros. El valor de noviembre es "hasta
//     hoy" y el de octubre es el mes completo: todos los días 1 el indicador se desplomaba
//     por una razón que no tiene nada que ver con la gente. Acá todos los meses se cortan
//     en el MISMO día del mes, así que la comparación mide trabajo y no calendario.
//
//  3. Contaba solo la cosecha. Un mes de mucho trasplante aparecía como un mes flojo, y eso
//     no es medir mal: es medir otra cosa. El trasplante es trabajo y entra.
//
// ── Por qué tres ratios y no uno ──
//
// Una planta trasplantada no cuesta el mismo trabajo que una cosechada. Sumarlas 1 a 1 es
// una decisión, no un hecho, y no hay con qué fundamentar otro peso todavía. Decisión de
// Marcos: 1 a 1 por ahora.
//
// Para que esa decisión se pueda revisar con datos y no con intuición, el combinado va
// acompañado de cosecha/hora y trasplante/hora por separado. Si el número se mueve, los dos
// de abajo dicen por cuál de los dos lados se movió. `PESO_TRASPLANTE` está acá arriba para
// cambiarlo en un lugar el día que se sepa.
//
// ── El granel ──
//
// Lo cosechado a granel se cuenta por PESO, no por cajón: un cajón de lechuga son ~19
// plantas, no una. La conversión ya la hace la carga de cosecha (ver lib/cosechaCajones.ts)
// y queda dentro de `unidades_cosechadas`; acá solo se estima cuánto de ese total vino por
// esa vía, para poder mostrarlo desglosado. Sin ese desglose, "52.640 plantas" no se puede
// discutir con nadie.

import type { Lote, Movimiento } from './types';
import { equivalenciaDeCajones } from './cosechaCajones';

// Cuánto cuenta una planta trasplantada frente a una cosechada. 1 = lo mismo.
export const PESO_TRASPLANTE = 1;

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export interface FilaHoras { fecha: string; horas_hombre: number | string }

export interface MesProductividad {
  mes: string;          // YYYY-MM
  label: string;        // "Nov 26"
  // Hasta qué día del mes llega la comparación. Todos los meses de la tabla usan el mismo.
  diaCorte: number;
  // Días del rango que tienen horas cargadas, y cuántos debería haber. Cuando no coinciden,
  // el número es correcto pero sobre menos días, y hay que decirlo.
  diasConDatos: number;
  diasDelRango: number;
  parcial: boolean;

  plantasCosechadas: number;
  plantasGranel: number;      // de las cosechadas, cuántas salieron en cajón
  plantasTrasplantadas: number;
  horas: number;

  // null cuando no hay horas: dividir por cero y mostrar 0 diría "no se trabajó", que es
  // distinto de "no sabemos cuánto se trabajó".
  plantasPorHora: number | null;
  cosechaPorHora: number | null;
  trasplantePorHora: number | null;
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];
const pad = (n: number) => String(n).padStart(2, '0');
const esRucula = (v: any) => {
  const s = String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.includes('rucula');
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// Días del rango que tienen horas cargadas. Mismo criterio que productividad.ts: la cosecha
// y el trasplante se recortan a ESTOS días, así el ratio es correcto desde el primer día de
// caché en vez de comparar todo el mes contra las horas de una sola jornada.
export function diasConHoras(cache: FilaHoras[], desde: string, hasta: string): Set<string> {
  const set = new Set<string>();
  for (const f of cache || []) {
    const d = String(f.fecha || '').slice(0, 10);
    if (d && d >= desde && d <= hasta && Number(f.horas_hombre) > 0) set.add(d);
  }
  return set;
}

// Las plantas que un lote cosechado aportó, y cuántas de ellas vinieron en cajón.
//
// Rúcula se cosecha en paquetes y se reconvierte con plantas_por_unidad_real (3 por
// defecto, el mismo factor que usa el resto de la app); lechuga ya viene en plantas.
export function plantasDeLote(l: Lote): { plantas: number; granel: number } {
  const unidades = Number(l.unidades_cosechadas) || 0;
  const factor = esRucula(l.variedad) ? (Number(l.plantas_por_unidad_real) || 3) : 1;

  const cajones = Number(l.cajones_armados) || 0;
  let granelUnidades = 0;
  if (cajones > 0) {
    // Mismo cálculo que hace la carga de cosecha, para que el desglose no contradiga al
    // total: si acá se convirtiera distinto, el "de las cuales a granel" podría dar más que
    // las cosechadas.
    granelUnidades = equivalenciaDeCajones({
      variedad: String(l.variedad || ''),
      cajones,
      kgPorCajon: 0,
      pesoPaqueteGr: Number(l.peso_muestra_paquete_gr) || 0,
    }).paquetesEquivalentes;
  }

  return {
    plantas: unidades * factor,
    // Tope en el total: el equivalente se recalcula con el gramaje de referencia cuando el
    // lote no guardó el pesaje, y podría dar un poco más que lo que se guardó ese día.
    // Mostrar un desglose mayor que el total haría desconfiar de los dos números.
    granel: Math.min(unidades * factor, granelUnidades * factor),
  };
}

// Un mes, cortado en `diaCorte`.
export function mesProductividad(args: {
  lotes: Lote[];
  movimientos: Movimiento[];
  horas: FilaHoras[];
  anio: number;
  mes: number;
  diaCorte: number;
}): MesProductividad {
  const { lotes, movimientos, horas, anio, mes, diaCorte } = args;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = Math.min(diaCorte, ultimoDia);
  const desdeStr = `${anio}-${pad(mes)}-01`;
  const hastaStr = `${anio}-${pad(mes)}-${pad(hasta)}`;

  const dias = diasConHoras(horas, desdeStr, hastaStr);

  let plantasCosechadas = 0, plantasGranel = 0;
  for (const l of lotes || []) {
    if (l.estado !== 'cosechado') continue;
    const f = soloFecha(l.fecha_cosecha || l.fecha_ult_movimiento);
    if (!f || !dias.has(f)) continue;
    const { plantas, granel } = plantasDeLote(l);
    plantasCosechadas += plantas;
    plantasGranel += granel;
  }

  let plantasTrasplantadas = 0;
  for (const m of movimientos || []) {
    if (String(m.tipo) !== 'trasplante') continue;
    const f = soloFecha(m.fecha);
    if (!f || !dias.has(f)) continue;
    plantasTrasplantadas += Number(m.plantas_estimadas) || 0;
  }

  let hs = 0;
  for (const f of horas || []) {
    const d = String(f.fecha || '').slice(0, 10);
    if (d && dias.has(d)) hs += Number(f.horas_hombre) || 0;
  }
  hs = r2(hs);

  const movidas = plantasCosechadas + plantasTrasplantadas * PESO_TRASPLANTE;
  return {
    mes: `${anio}-${pad(mes)}`,
    label: `${MESES_CORTO[mes - 1]} ${String(anio).slice(2)}`,
    diaCorte: hasta,
    diasConDatos: dias.size,
    diasDelRango: hasta,
    parcial: dias.size < hasta,
    plantasCosechadas: Math.round(plantasCosechadas),
    plantasGranel: Math.round(plantasGranel),
    plantasTrasplantadas: Math.round(plantasTrasplantadas),
    horas: hs,
    plantasPorHora: hs > 0 ? r2(movidas / hs) : null,
    cosechaPorHora: hs > 0 ? r2(plantasCosechadas / hs) : null,
    trasplantePorHora: hs > 0 ? r2(plantasTrasplantadas / hs) : null,
  };
}

// Los últimos N meses hasta `hoy`, todos cortados en el mismo día del mes.
//
// El corte común es lo que hace comparable la tabla: el mes en curso va hasta hoy, así que
// los anteriores van hasta ese mismo día. Un mes más corto que el día de corte (febrero
// contra un corte el 30) usa su último día, y eso queda dicho en `diaCorte`.
export function tablaProductividad(args: {
  lotes: Lote[];
  movimientos: Movimiento[];
  horas: FilaHoras[];
  hoy: string;       // YYYY-MM-DD
  meses?: number;
}): MesProductividad[] {
  const { lotes, movimientos, horas, hoy } = args;
  const meses = args.meses ?? 3;
  const [a, m, d] = hoy.split('-').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(m)) return [];

  const out: MesProductividad[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    let anio = a, mes = m - i;
    while (mes <= 0) { mes += 12; anio--; }
    out.push(mesProductividad({ lotes, movimientos, horas, anio, mes, diaCorte: d }));
  }
  return out;
}

// La variación entre los dos últimos meses de la tabla, en porcentaje. null cuando alguno
// de los dos no tiene número: un "—" dice "no sé", un 0% dice "no cambió".
export function variacion(anterior: number | null, actual: number | null): number | null {
  if (anterior === null || actual === null || anterior === 0) return null;
  return Math.round(((actual - anterior) / anterior) * 1000) / 10;
}
