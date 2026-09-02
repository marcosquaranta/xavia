import type { Lote, VentaDia, PrecioVenta, ClienteVenta, Articulo } from './types';
import { ventasEnRango } from './estadisticasVentas';

const CUBOS_POR_PLANCHA = 345;

export const DRIVERS = [
  { key: 'planchas_sembradas_rucula',   label: 'Planchas sembradas — rúcula' },
  { key: 'planchas_sembradas_lechuga',  label: 'Planchas sembradas — lechuga (todas)' },
  { key: 'planchas_sembradas_lechuga_crespa', label: 'Planchas sembradas — lechuga crespa' },
  { key: 'planchas_sembradas_lechuga_roble',  label: 'Planchas sembradas — lechuga hoja de roble' },
  { key: 'planchas_sembradas_lechuga_otras',  label: 'Planchas sembradas — lechuga otras variedades' },
  { key: 'planchas_sembradas_albahaca', label: 'Planchas sembradas — albahaca' },
  { key: 'planchas_sembradas_total',    label: 'Planchas sembradas — total' },
  // OJO: estos 3 incluyen las ventas por KG convertidas a paquete-equivalente. Sirven para
  // insumos que se consumen igual se venda como se venda (semilla, sustrato, fertilizante),
  // NO para packaging: una venta por kg va en cajón y no lleva bolsa, y una bandeja lleva
  // su propia bandeja. Para esos casos están los drivers de más abajo.
  { key: 'paquetes_vendidos_rucula',    label: 'Paquetes vendidos — rúcula (incluye kg y bandeja)' },
  { key: 'paquetes_vendidos_lechuga',   label: 'Paquetes vendidos — lechuga (incluye kg)' },
  { key: 'paquetes_vendidos_total',     label: 'Paquetes vendidos — total (incluye kg y bandeja)' },
  // Packaging: solo las presentaciones que realmente consumen ese insumo.
  { key: 'paquetes_vendidos_rucula_bolsa',   label: 'Paquetes vendidos — rúcula EN BOLSA (sin kg ni bandeja)' },
  { key: 'paquetes_vendidos_rucula_sin_kg',  label: 'Paquetes vendidos — rúcula sin kg (paquete + bandeja)' },
  { key: 'bandejas_vendidas_rucula',         label: 'Bandejas vendidas — rúcula' },
  { key: 'paquetes_vendidos_lechuga_sin_kg', label: 'Paquetes vendidos — lechuga sin kg' },
  { key: 'paquetes_vendidos_total_sin_kg',   label: 'Paquetes vendidos — total sin kg' },
  { key: 'paquetes_vendidos_albahaca',       label: 'Paquetes vendidos — albahaca' },
  { key: 'paquetes_cosechados_rucula',  label: 'Paquetes cosechados — rúcula' },
  { key: 'plantas_cosechadas_lechuga',  label: 'Plantas cosechadas — lechuga' },
  { key: 'paquetes_cosechados_albahaca', label: 'Paquetes cosechados — albahaca' },
  { key: 'lotes_sembrados',             label: 'Lotes sembrados' },
  { key: 'lotes_cosechados',            label: 'Lotes cosechados' },
] as const;
export type DriverKey = typeof DRIVERS[number]['key'];

export type DriversMes = Record<DriverKey, number>;

function parseF(s: any): Date | null {
  if (!s) return null;
  try { return new Date(String(s).split(/[\sT]/)[0]); } catch { return null; }
}
function esRucula(l: Lote): boolean {
  const v = String(l.variedad || '').toLowerCase();
  return v.includes('rucula') || v.includes('rúcula');
}
// Mismo criterio de matching por texto que ya usa el resto del sistema (cosechaSemanaActual
// en lib/estadisticas.ts) para distinguir sub-variedades de lechuga dentro de "variedad".
function esCrespa(l: Lote): boolean { return String(l.variedad || '').toLowerCase().includes('crespa'); }
function esRoble(l: Lote): boolean { return String(l.variedad || '').toLowerCase().includes('roble'); }
function esAlbahaca(l: Lote): boolean { return String(l.variedad || '').toLowerCase().includes('albahaca'); }

// Mismas fórmulas que ya usaba el panel "Usos del sistema" de Stocks — acá quedan
// centralizadas para poder reutilizarlas en el cálculo de Uso Teórico por artículo.
export function calcularDriversMes(
  lotes: Lote[], ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], anio: number, mes: number
): DriversMes {
  const inicioMes = new Date(anio, mes - 1, 1);
  const finMes = new Date(anio, mes, 0, 23, 59, 59);

  const sembrados = lotes.filter((l) => { const f = parseF(l.fecha_siembra); return f && f >= inicioMes && f <= finMes; });
  const cosechados = lotes.filter((l) => { if (l.estado !== 'cosechado') return false; const f = parseF(l.fecha_cosecha); return f && f >= inicioMes && f <= finMes; });

  // "Lechuga" = ni rúcula ni albahaca. Antes era simplemente "todo lo que no es rúcula",
  // así que la albahaca se contaba como lechuga y sobreestimaba sus insumos (aunque comparta
  // la misma espuma de siembra que la rúcula, es un cultivo aparte con sus propios drivers).
  const sembLechuga  = sembrados.filter((l) => !esRucula(l) && !esAlbahaca(l));
  const sembRucula   = sembrados.filter((l) => esRucula(l));
  const sembAlbahaca = sembrados.filter((l) => esAlbahaca(l));
  const planchasDe = (arr: Lote[]) => Math.round(arr.reduce((a, l) => a + (Number(l.plantines_iniciales) || 0), 0) / CUBOS_POR_PLANCHA);
  const planchasLechuga = planchasDe(sembLechuga);
  const planchasRucula  = planchasDe(sembRucula);
  const planchasLechugaCrespa = planchasDe(sembLechuga.filter(esCrespa));
  const planchasLechugaRoble  = planchasDe(sembLechuga.filter(esRoble));
  const planchasLechugaOtras  = planchasDe(sembLechuga.filter((l) => !esCrespa(l) && !esRoble(l)));

  const planchasAlbahaca = planchasDe(sembAlbahaca);

  const paqRucula   = cosechados.filter((l) => esRucula(l)).reduce((a, l) => a + (Number(l.unidades_cosechadas) || 0), 0);
  const plantasLech = cosechados.filter((l) => !esRucula(l) && !esAlbahaca(l)).reduce((a, l) => a + (Number(l.unidades_cosechadas) || 0), 0);
  const paqAlbahaca = cosechados.filter((l) => esAlbahaca(l)).reduce((a, l) => a + (Number(l.unidades_cosechadas) || 0), 0);

  const desde = inicioMes.toISOString().slice(0, 10);
  const hasta = finMes.toISOString().slice(0, 10);
  const ventasRango = ventasEnRango(ventas, precios, clientes, desde, hasta);

  // Desglose para los drivers de packaging: de las unidades totales de rúcula se sacan las
  // que vinieron por kg (van en cajón, sin bolsa) y las bandejas (packaging propio), y
  // queda solo lo que efectivamente se embolsó. Ídem lechuga sin la parte de kg.
  const rucKg = ventasRango.rucula.unidadesKg;
  const rucBandeja = ventasRango.rucula.unidadesBandeja;
  const rucBolsa = Math.max(0, ventasRango.rucula.unidades - rucKg - rucBandeja);
  const lechSinKg = Math.max(0, ventasRango.lechuga.unidades - ventasRango.lechuga.unidadesKg);

  return {
    planchas_sembradas_rucula: planchasRucula,
    planchas_sembradas_lechuga: planchasLechuga,
    planchas_sembradas_lechuga_crespa: planchasLechugaCrespa,
    planchas_sembradas_lechuga_roble: planchasLechugaRoble,
    planchas_sembradas_lechuga_otras: planchasLechugaOtras,
    planchas_sembradas_albahaca: planchasAlbahaca,
    planchas_sembradas_total: planchasRucula + planchasLechuga + planchasAlbahaca,
    paquetes_vendidos_rucula: ventasRango.rucula.unidades,
    paquetes_vendidos_lechuga: ventasRango.lechuga.unidades,
    paquetes_vendidos_total: ventasRango.rucula.unidades + ventasRango.lechuga.unidades,
    paquetes_vendidos_rucula_bolsa: rucBolsa,
    paquetes_vendidos_rucula_sin_kg: rucBolsa + rucBandeja,
    bandejas_vendidas_rucula: rucBandeja,
    paquetes_vendidos_lechuga_sin_kg: lechSinKg,
    paquetes_vendidos_total_sin_kg: rucBolsa + rucBandeja + lechSinKg,
    paquetes_vendidos_albahaca: ventasRango.albahaca.unidades,
    paquetes_cosechados_rucula: paqRucula,
    plantas_cosechadas_lechuga: plantasLech,
    paquetes_cosechados_albahaca: paqAlbahaca,
    lotes_sembrados: sembrados.length,
    lotes_cosechados: cosechados.length,
  };
}

export function calcularUsoTeorico(formulaUso: string, factorUso: number, drivers: DriversMes): number | null {
  if (!formulaUso) return null;
  const driverValue = (drivers as any)[formulaUso];
  if (driverValue === undefined) return null;
  return driverValue * (Number(factorUso) || 0);
}

// ── Categorías sin uso teórico ───────────────────────────────────────────────────────
// Hay insumos cuyo consumo no lo manda ningún driver de producción ni de venta: los
// fertilizantes y el ácido se dosifican por lectura del tanque (conductividad y pH, que
// dependen del agua y del clima, no de cuántas planchas se sembraron), los cajones
// plásticos son retornables y "Varios" es un cajón de sastre con cosas que no se parecen
// entre sí. Para esos, tanto el uso teórico como su referencia estimada son números
// inventados que ensucian la lectura: la columna queda en "—" y la comparación que sí
// significa algo pasa a ser contra el uso del mes pasado, que es un dato medido.
const CATEGORIAS_SIN_USO_TEORICO = ['fertilizante', 'acido', 'cajon', 'vario'];

export function categoriaSinUsoTeorico(categoria: string): boolean {
  const c = String(categoria || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return CATEGORIAS_SIN_USO_TEORICO.some((k) => c.includes(k));
}

// Uso teórico de un artículo concreto: lo mismo que calcularUsoTeorico pero respetando las
// categorías excluidas. Es el que hay que usar siempre que se tenga el artículo a mano.
export function usoTeoricoDeArticulo(
  art: Pick<Articulo, 'categoria' | 'formula_uso' | 'factor_uso'>, drivers: DriversMes,
): number | null {
  if (categoriaSinUsoTeorico(art.categoria)) return null;
  return calcularUsoTeorico(art.formula_uso, Number(art.factor_uso) || 0, drivers);
}

// Para artículos SIN fórmula de uso teórico configurada (ácidos, sales, insumos genéricos
// que no dependen de plantines sembrados): en vez de dejar "—", damos una referencia estimando
// que el uso escala junto con el volumen de venta total respecto del mes anterior. No es un
// target preciso como el uso teórico (por eso se marca aparte en la UI), es sólo una guía.
export function calcularUsoReferencia(usoMesAnterior: number | null, ventasActualTotal: number, ventasAnteriorTotal: number): number | null {
  if (usoMesAnterior === null || usoMesAnterior <= 0) return null;
  if (ventasAnteriorTotal <= 0) return usoMesAnterior; // sin base de comparación, se mantiene plano
  return usoMesAnterior * (ventasActualTotal / ventasAnteriorTotal);
}
