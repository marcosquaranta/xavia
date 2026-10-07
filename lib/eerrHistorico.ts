import { readSheet } from './sheets';
import { calcularEERR, LINEAS_VARIABLE, FIJOS, type EERR, type DatosEERR } from './eerr';
import { leerPrevisiones, previsionDelMes, type PrevisionMes } from './previsiones';
import type { Articulo, StockMes, Gasto, VentaDia, PrecioVenta, ClienteVenta } from './types';

// ── Histórico del EERR: todos los meses en una tabla ──────────────────────────────────
//
// El cierre de un mes suelto dice poco. Lo que se lee de verdad es la serie: si el alquiler
// viene subiendo tres meses seguidos, si los sueldos pesan cada vez más, si el resultado
// mejora o es un buen mes aislado. Eso es lo que antes había que armar copiando columnas de
// un Excel al lado del otro.
//
// Acá no se copia nada: cada mes se recalcula sobre los mismos datos cargados, con las
// MISMAS líneas y en el mismo orden que el cierre mensual. Si mañana se corrige un gasto de
// mayo, mayo cambia en la serie — es una consulta, no una foto.
//
// Las previsiones se toman solo de lo GUARDADO, nunca de la sugerencia. Un mes al que nadie
// le confirmó las previsiones aparece sin ellas, y eso es más honesto que mostrar una
// estimación en una tabla donde todo lo demás es real: en la serie no se vería la diferencia
// entre un número cerrado y uno propuesto.

export const MESES_CORTO_EERR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export interface MesEERR {
  anio: number;
  mes: number;
  label: string;        // "Ago 2026"
  clave: string;        // "2026-08"
  eerr: EERR;
  // Si nadie confirmó las previsiones de ese mes, el resultado no las incluye. Se marca para
  // poder avisarlo en la tabla en vez de que el mes se lea como cerrado cuando no lo está.
  previsionesConfirmadas: boolean;
}

export interface FilaHistorico {
  label: string;
  bloque: 'ventas' | 'variable' | 'fijos' | 'resultado';
  nivel: 'total' | 'detalle';
  // Un valor por mes, en el mismo orden que `meses`.
  montos: number[];
}

export interface HistoricoEERR {
  meses: MesEERR[];
  filas: FilaHistorico[];
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

// Los meses que tienen algo cargado, del más viejo al último mes CERRADO.
//
// El mes en curso queda afuera: siempre tiene las ventas de unos días contra gastos fijos
// que ya se pagaron enteros, así que aparece como un derrumbe que no es real. En una tabla
// de comparación ese mes falso es peor que en una pantalla sola, porque arrastra la lectura
// de toda la serie.
//
// Sin huecos: un mes sin movimiento en el medio va igual, en cero. Si los meses aparecen y
// desaparecen, dos columnas contiguas pueden ser enero y abril y nadie lo nota.
export function mesesConDatos(gastos: Gasto[], ventas: VentaDia[], hoy = new Date()): { anio: number; mes: number }[] {
  let min = '';
  for (const g of gastos) {
    const f = soloFecha((g as any).fecha);
    if (f && /^\d{4}-\d{2}/.test(f) && (!min || f < min)) min = f;
  }
  for (const v of ventas) {
    const f = soloFecha((v as any).fecha);
    if (f && /^\d{4}-\d{2}/.test(f) && (!min || f < min)) min = f;
  }
  if (!min) return [];

  const desde = new Date(Number(min.slice(0, 4)), Number(min.slice(5, 7)) - 1, 1);
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); // último mes cerrado
  const out: { anio: number; mes: number }[] = [];
  const cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
  // Tope de 36 meses: más que eso no se compara, se archiva, y cada mes es una pasada sobre
  // todos los gastos y ventas cargados.
  while (cur <= hasta && out.length < 36) {
    out.push({ anio: cur.getFullYear(), mes: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

export interface DatosHistorico {
  datos: Omit<DatosEERR, 'previsiones'>;
  previsiones: PrevisionMes[];
}

export async function cargarDatosHistorico(): Promise<DatosHistorico> {
  const [articulos, stocks, gastos, ventas, precios, clientes, previsiones] = await Promise.all([
    readSheet<Articulo>('Articulos'),
    readSheet<StockMes>('Stocks'),
    readSheet<Gasto>('Gastos'),
    readSheet<VentaDia>('Ventas'),
    readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
    readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
    leerPrevisiones().catch(() => [] as PrevisionMes[]),
  ]);
  return { datos: { articulos, stocks, gastos, ventas, precios, clientes }, previsiones };
}

export function calcularMes(d: DatosHistorico, anio: number, mes: number): MesEERR {
  const g = previsionDelMes(d.previsiones, anio, mes);
  const prev = g ? { despidos: Number(g.despidos) || 0, sac: Number(g.sac) || 0 } : null;
  return {
    anio, mes,
    label: `${MESES_CORTO_EERR[mes - 1]} ${anio}`,
    clave: `${anio}-${String(mes).padStart(2, '0')}`,
    eerr: calcularEERR({ ...d.datos, previsiones: prev }, anio, mes),
    previsionesConfirmadas: !!g,
  };
}

// La tabla completa. Las filas son fijas —las mismas líneas del cierre, estén o no en cero—
// porque una fila que aparece solo en los meses que tuvo movimiento no se puede seguir con
// la vista a lo largo de la serie.
export function historicoEERR(d: DatosHistorico, meses: { anio: number; mes: number }[]): HistoricoEERR {
  const calculados = meses.map((m) => calcularMes(d, m.anio, m.mes));
  const en = (f: (e: EERR) => number) => calculados.map((m) => f(m.eerr));
  const deLinea = (bloque: 'costoVariable' | 'costosFijos', label: string) =>
    calculados.map((m) => m.eerr[bloque].lineas.find((l) => l.label === label)?.monto ?? 0);

  const filas: FilaHistorico[] = [
    { label: 'Ventas', bloque: 'ventas', nivel: 'total', montos: en((e) => e.ventas.total) },
    ...['Rúcula', 'Lechuga', 'Albahaca'].map((l): FilaHistorico => ({
      label: l, bloque: 'ventas', nivel: 'detalle',
      montos: calculados.map((m) => m.eerr.ventas.porCultivo.find((c) => c.label === l)?.monto ?? 0),
    })),

    { label: 'Costo variable', bloque: 'variable', nivel: 'total', montos: en((e) => e.costoVariable.total) },
    ...LINEAS_VARIABLE.map((l): FilaHistorico => ({
      label: l.label, bloque: 'variable', nivel: 'detalle', montos: deLinea('costoVariable', l.label),
    })),

    { label: 'Costos fijos', bloque: 'fijos', nivel: 'total', montos: en((e) => e.costosFijos.total) },
    ...FIJOS.map((l): FilaHistorico => ({
      label: l.label, bloque: 'fijos', nivel: 'detalle', montos: deLinea('costosFijos', l.label),
    })),

    { label: 'Resultado final', bloque: 'resultado', nivel: 'total', montos: en((e) => e.resultado) },
    { label: 'Resultado sin inversión', bloque: 'resultado', nivel: 'total', montos: en((e) => e.resultadoSinInversion) },
  ];

  // Una línea de detalle que está en cero en TODOS los meses no agrega nada y ocupa una fila
  // en una tabla que ya es larga. Los totales y los resultados quedan siempre, incluso en
  // cero: que un bloque entero esté vacío es información.
  const filasUtiles = filas.filter((f) => f.nivel === 'total' || f.montos.some((n) => Math.round(n) !== 0));

  return { meses: calculados, filas: filasUtiles };
}
