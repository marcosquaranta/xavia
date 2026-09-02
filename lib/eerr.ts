import type { Articulo, StockMes, Gasto, VentaDia, PrecioVenta, ClienteVenta, CategoriaGasto } from './types';
import { ventasEnRango } from './estadisticasVentas';
import { precioUltimoConocido } from './valorizacionStock';

// ── Estado de resultados del mes ──────────────────────────────────────────────────────
//
// Reemplaza al Excel que se armaba a mano copiando el mes anterior. Acá no se copia nada:
// es una consulta sobre lo que ya está cargado, así que un gasto que aparece tarde —el
// resumen de la tarjeta, por ejemplo— se carga con SU fecha y el mes se recalcula solo.
//
// Las tres reglas que definen de dónde sale cada peso:
//
// 1. COSTO VARIABLE de insumos = lo que se CONSUMIÓ, no lo que se compró. Sale de Stocks:
//    `inicial + compras − final`, valorizado al último precio conocido. Es la misma cuenta
//    que hace el Excel con sus columnas de "venta de stock al mes siguiente".
// 2. Los gastos de categoría 'insumos' NO se suman. Esos gastos alimentan la columna de
//    compras de Stocks (ver "Sugerencias de compra desde Gastos"), así que contarlos además
//    como costo sería contar la misma compra dos veces. Si alguno quedó sin aplicar a stock,
//    no está en ningún lado: eso se avisa.
// 3. Fletes, energía y cultivos de reventa son costo variable pero NO pasan por Stocks:
//    salen de Gastos. Si alguna vez existiera un artículo de stock en una categoría "Fletes",
//    se contaría dos veces — por eso el costo de esas tres líneas sale solo de Gastos.
//
// Fuera del resultado quedan: 'movimiento_interno' (pagar el resumen de la tarjeta mueve
// plata del banco a la tarjeta, no genera un gasto nuevo) y el medio de pago 'Aporte socios'
// (es financiamiento).

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };

// Categorías de gasto que son COSTO VARIABLE, con el nombre que llevan en el EERR.
const VARIABLES_DE_GASTOS: { cat: CategoriaGasto; label: string }[] = [
  { cat: 'fletes_combustible', label: 'Fletes y combustible' },
  { cat: 'energia_agua', label: 'Energía + agua' },
  { cat: 'cultivos_reventa', label: 'Cultivos de reventa' },
];

// Costos fijos: cada línea del EERR y las categorías de gasto que la componen.
const FIJOS: { label: string; cats: CategoriaGasto[]; esInversion?: boolean }[] = [
  { label: 'Sueldos equipo', cats: ['sueldos'] },
  { label: 'Mantenimiento', cats: ['mantenimiento'] },
  { label: 'Inversión en equipamiento', cats: ['inversion_equipamiento', 'inversion_nave3'], esInversion: true },
  { label: 'Impuestos', cats: ['impuestos'] },
  { label: 'Alquiler', cats: ['alquiler'] },
  { label: 'Staff (contador, marketing, asesoramiento)', cats: ['staff'] },
  { label: 'Otros (abonos, seguros, trámites)', cats: ['abonos', 'gastos_generales'] },
];

export interface LineaEERR { label: string; monto: number; fuente: 'stock' | 'gastos' }
export interface LineaVenta { label: string; unidades: number; monto: number }

export interface EERR {
  anio: number;
  mes: number;
  ventas: { total: number; porCultivo: LineaVenta[] };
  costoVariable: { total: number; lineas: LineaEERR[] };
  costosFijos: { total: number; sinInversion: number; lineas: LineaEERR[] };
  otrosIngresos: number;
  resultado: number;
  resultadoSinInversion: number;
  masaSalarial: number;        // base de las previsiones de despidos y SAC
  avisos: string[];            // datos faltantes que hacen que el resultado no cierre
}

export interface DatosEERR {
  articulos: Articulo[];
  stocks: StockMes[];
  gastos: Gasto[];
  ventas: VentaDia[];
  precios: PrecioVenta[];
  clientes: ClienteVenta[];
}

export function calcularEERR(d: DatosEERR, anio: number, mes: number): EERR {
  const mm = String(mes).padStart(2, '0');
  const desde = `${anio}-${mm}-01`;
  const hasta = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;

  // ── Ventas ──
  const vr = ventasEnRango(d.ventas, d.precios, d.clientes, desde, hasta);
  const porCultivo: LineaVenta[] = [
    { label: 'Rúcula', unidades: vr.rucula.unidades, monto: vr.rucula.monto },
    { label: 'Lechuga', unidades: vr.lechuga.unidades, monto: vr.lechuga.monto },
    { label: 'Albahaca', unidades: vr.albahaca.unidades, monto: vr.albahaca.monto },
  ];
  const totalVentas = porCultivo.reduce((a, c) => a + c.monto, 0);

  // ── Costo variable de insumos: consumo valorizado, por categoría de artículo ──
  const avisos: string[] = [];
  const activos = d.articulos.filter((a) => a.activo === 'SI');
  const consumoPorCat = new Map<string, number>();
  let sinPrecio = 0, sinStockFinal = 0;

  for (const art of activos) {
    const s = d.stocks.find((st) => String(st.id_articulo) === String(art.id_articulo)
      && String(st.anio) === String(anio) && String(st.mes) === String(mes));
    if (!s) continue;
    const ini = num(s.stock_inicial), comp = num(s.compras), fin = num(s.stock_final);
    if (!ini && !comp && !fin) continue;
    // Vacío no es cero: sin recuento final el consumo daría igual a todo el stock inicial.
    if (String(s.stock_final ?? '').trim() === '') { sinStockFinal++; continue; }
    const consumo = ini + comp - fin;
    const precio = precioUltimoConocido(d.stocks, art.id_articulo, anio, mes);
    if (precio === null) { if (consumo !== 0) sinPrecio++; continue; }
    consumoPorCat.set(art.categoria, (consumoPorCat.get(art.categoria) || 0) + consumo * precio);
  }

  const gastosMes = d.gastos.filter((g) => {
    const f = String(g.fecha || '').split(/[T ]/)[0];
    return f >= desde && f <= hasta;
  });
  const sumaCats = (cats: CategoriaGasto[]) =>
    gastosMes.filter((g) => cats.includes(g.categoria)).reduce((a, g) => a + num(g.monto), 0);

  const lineasVariable: LineaEERR[] = [
    ...[...consumoPorCat.entries()]
      .map(([categoria, monto]) => ({ label: categoria, monto, fuente: 'stock' as const }))
      .sort((a, b) => b.monto - a.monto),
    ...VARIABLES_DE_GASTOS
      .map(({ cat, label }) => ({ label, monto: sumaCats([cat]), fuente: 'gastos' as const }))
      .filter((l) => l.monto !== 0),
  ];
  const totalVariable = lineasVariable.reduce((a, l) => a + l.monto, 0);

  // ── Costos fijos ──
  const lineasFijas: LineaEERR[] = FIJOS
    .map(({ label, cats }) => ({ label, monto: sumaCats(cats), fuente: 'gastos' as const }))
    .filter((l) => l.monto !== 0);
  const totalFijos = lineasFijas.reduce((a, l) => a + l.monto, 0);
  const inversion = sumaCats(['inversion_equipamiento', 'inversion_nave3']);
  const otrosIngresos = sumaCats(['otros_ingresos']);
  const masaSalarial = sumaCats(['sueldos']);

  // ── Avisos: lo que hace que el número no cierre ──
  const insumosSinAplicar = gastosMes.filter((g) => g.categoria === 'insumos' && g.aplicado_stock !== 'SI');
  if (insumosSinAplicar.length) {
    const monto = insumosSinAplicar.reduce((a, g) => a + num(g.monto), 0);
    avisos.push(`${insumosSinAplicar.length} gasto(s) de insumos por $${Math.round(monto).toLocaleString('es-AR')} sin aplicar a Stocks: esa compra no está en el costo de ningún lado.`);
  }
  if (sinStockFinal) avisos.push(`${sinStockFinal} artículo(s) con movimiento pero sin stock final cargado: su consumo no se puede calcular y falta en el costo variable.`);
  if (sinPrecio) avisos.push(`${sinPrecio} artículo(s) consumidos sin precio de compra conocido: su consumo no se puede valorizar.`);

  const resultado = totalVentas + otrosIngresos - totalVariable - totalFijos;
  return {
    anio, mes,
    ventas: { total: totalVentas, porCultivo },
    costoVariable: { total: totalVariable, lineas: lineasVariable },
    costosFijos: { total: totalFijos, sinInversion: totalFijos - inversion, lineas: lineasFijas },
    otrosIngresos,
    resultado,
    resultadoSinInversion: resultado + inversion,
    masaSalarial,
    avisos,
  };
}

// ── Previsiones ───────────────────────────────────────────────────────────────────────
// Se calculan sobre la masa salarial del mes: despidos 6%, SAC un doceavo. Son propuestas —
// el valor guardado manda si existe, porque hay meses con ajustes que ninguna fórmula sabe.
export const PCT_PREVISION_DESPIDOS = 0.06;
export const DIVISOR_PREVISION_SAC = 12;

export function previsionesSugeridas(masaSalarial: number): { despidos: number; sac: number } {
  return {
    despidos: masaSalarial * PCT_PREVISION_DESPIDOS,
    sac: masaSalarial / DIVISOR_PREVISION_SAC,
  };
}
