import type { Articulo, StockMes, Gasto, VentaDia, PrecioVenta, ClienteVenta, CategoriaGasto } from './types';
import { ARTICULOS } from './articulos';
import { nombreClienteVisible } from './clientes';
import { precioFinal } from './estadisticasVentas';
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
// 3. Fletes y energía son costo variable pero NO pasan por Stocks: salen de Gastos. Si
//    alguna vez existiera un artículo de stock en una categoría "Fletes", se contaría dos
//    veces — por eso el costo de esas dos líneas sale solo de Gastos.
//
//    Los cultivos de reventa SÍ pasan por Stocks: son un rubro de insumos más (se compran,
//    quedan en el depósito y se consumen), así que su costo es el consumo valorizado y no lo
//    comprado en el mes. Sus gastos tampoco se suman, por la misma razón que los de insumos.
//
// Fuera del resultado quedan: 'movimiento_interno' (pagar el resumen de la tarjeta mueve
// plata del banco a la tarjeta, no genera un gasto nuevo) y el medio de pago 'Aporte socios'
// (es financiamiento).

import { lineasImposibles } from './montoSospechoso';
const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };

// Las líneas del EERR son las MISMAS que las del Excel y en el mismo orden, aunque en el mes
// no tengan movimiento: si aparecen y desaparecen según el mes, no se puede comparar una
// columna contra la otra ni contra el Excel.
//
// Las categorías de artículo son texto libre en la planilla ("PACKAGING", "Bolsas"), así que
// se mapean por palabra clave. Lo que no cae en ninguna va a Varios, igual que en el Excel.
// Exportadas para que la grilla de carga rápida use EXACTAMENTE esta misma estructura — las
// mismas 12 + 8 líneas, mismo orden, mismas etiquetas — en vez de mantener una segunda lista
// a mano que se puede desalinear con el cálculo real del EERR.
export const LINEAS_VARIABLE: { label: string; claves?: string[]; cat?: CategoriaGasto }[] = [
  { label: 'Ácido', claves: ['acido'] },
  { label: 'Packaging', claves: ['packaging', 'bolsa'] },
  { label: 'Cajones plásticos', claves: ['cajon'] },
  { label: 'Espuma fenólica', claves: ['espuma'] },
  { label: 'Fertilizantes', claves: ['fertilizante'] },
  { label: 'Fletes y combustible', cat: 'fletes_combustible' },
  { label: 'Foliares', claves: ['foliar'] },
  { label: 'Semillas', claves: ['semilla'] },
  { label: 'Energía + agua', cat: 'energia_agua' },
  { label: 'Insumos de limpieza', claves: ['limpieza'] },
  { label: 'Cultivos de reventa', claves: ['reventa'] },
  { label: 'Varios', claves: [] },   // catch-all: todo lo que no matcheó arriba
];

// Costos fijos: cada línea del EERR y las categorías de gasto que la componen.
// "Otros ingresos y egresos" va acá adentro, no aparte: en el Excel es una línea más de
// costos fijos (verificado — las ocho líneas suman exactamente el total del bloque).
export const FIJOS: { label: string; cats: CategoriaGasto[]; esInversion?: boolean }[] = [
  { label: 'Sueldos equipo', cats: ['sueldos'] },
  { label: 'Mantenimiento', cats: ['mantenimiento'] },
  { label: 'Inversión en equipamiento', cats: ['inversion_equipamiento', 'inversion_nave3'], esInversion: true },
  { label: 'Impuestos (autónomos, IVA, IIBB)', cats: ['impuestos'] },
  { label: 'Alquiler', cats: ['alquiler'] },
  { label: 'Staff (contador, marketing, asesoramiento)', cats: ['staff'] },
  { label: 'Otros (abonos, seguros, trámites)', cats: ['abonos', 'gastos_generales'] },
  { label: 'Otros ingresos (Rdo FCI) y egresos', cats: ['otros_ingresos'] },
];

const normalizar = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function lineaDeCategoria(categoria: string): string {
  const c = normalizar(categoria);
  for (const l of LINEAS_VARIABLE) {
    if (l.claves && l.claves.length && l.claves.some((k) => c.includes(k))) return l.label;
  }
  return 'Varios';
}

export interface LineaEERR {
  label: string;
  monto: number;
  fuente: 'stock' | 'gastos';
  // Solo en las líneas de stock: lo que se COMPRÓ en el mes y lo que quedó inmovilizado.
  // El costo del mes es el consumo —había + compró − quedó— y ese es `monto`. Las compras
  // van al lado porque son dos números distintos que la gente confunde todo el tiempo: un
  // mes se puede comprar el triple de lo que se consume y el costo no se mueve.
  compras?: number;
  variacionStock?: number;  // positivo = quedó más stock que al empezar
}
export interface LineaVenta { label: string; unidades: number; monto: number }

export interface EERR {
  anio: number;
  mes: number;
  ventas: { total: number; porCultivo: LineaVenta[] };
  costoVariable: { total: number; lineas: LineaEERR[] };
  costosFijos: { total: number; sinInversion: number; lineas: LineaEERR[] };
  inversion: number;
  resultado: number;
  resultadoSinInversion: number;
  masaSalarial: number;        // base de las previsiones de despidos y SAC
  avisos: string[];            // datos faltantes que hacen que el resultado no cierre
}

export interface DatosEERR {
  articulos: Articulo[];
  stocks: StockMes[];
  gastos: Gasto[];
  // Previsiones del mes (despidos y SAC). Son costo del mes aunque la plata no salga: el SAC
  // se paga en junio y diciembre, pero se gana todos los meses. Que la plata siga en la
  // cuenta no la hace disponible, la hace comprometida.
  //
  // Solo despidos y SAC: alquiler y EPE también se cargan como previsión, pero esos SÍ se
  // registran como gasto cuando se pagan, así que sumarlos acá los contaría dos veces.
  previsiones?: { despidos: number; sac: number } | null;
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
  const comprasPorCat = new Map<string, number>();
  const stockPorCat = new Map<string, number>();
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
    const linea = lineaDeCategoria(art.categoria);
    consumoPorCat.set(linea, (consumoPorCat.get(linea) || 0) + consumo * precio);
    comprasPorCat.set(linea, (comprasPorCat.get(linea) || 0) + comp * precio);
    stockPorCat.set(linea, (stockPorCat.get(linea) || 0) + (fin - ini) * precio);
  }

  // TODO lo del mes, esté pagado o no: el costo pertenece al mes en que se compró. Criterio
  // devengado, definido por Marcos. Una compra a 30 días es un costo de este mes aunque la
  // plata salga el que viene; lo que se mueve con el pago son los saldos de caja, no esto.
  const gastosMes = d.gastos.filter((g) => {
    const f = String(g.fecha || '').split(/[T ]/)[0];
    return f >= desde && f <= hasta;
  });
  const sumaCats = (cats: CategoriaGasto[]) =>
    gastosMes.filter((g) => cats.includes(g.categoria)).reduce((a, g) => a + num(g.monto), 0);

  const lineasVariable: LineaEERR[] = LINEAS_VARIABLE.map((l) => (
    l.cat
      ? { label: l.label, monto: sumaCats([l.cat]), fuente: 'gastos' as const }
      : {
          label: l.label,
          monto: consumoPorCat.get(l.label) || 0,
          fuente: 'stock' as const,
          compras: comprasPorCat.get(l.label) || 0,
          variacionStock: stockPorCat.get(l.label) || 0,
        }
  ));
  const totalVariable = lineasVariable.reduce((a, l) => a + l.monto, 0);

  // ── Costos fijos ──
  const lineasFijas: LineaEERR[] = FIJOS
    .map(({ label, cats }) => ({ label, monto: sumaCats(cats), fuente: 'gastos' as const }));

  // Las previsiones van DENTRO de Sueldos, no como línea aparte: son costo laboral del mes
  // igual que el sueldo —el SAC se gana todos los meses aunque se pague en junio y diciembre,
  // y los despidos se devengan mientras la persona trabaja—. Separadas, la línea de sueldos
  // mostraba menos de lo que el equipo cuesta de verdad.
  //
  // Ojo con la masa salarial: sale de los GASTOS de sueldos, no de esta línea. Si saliera de
  // acá, las previsiones se calcularían sobre sí mismas y creciendo mes a mes.
  const montoPrevisiones = Math.round((d.previsiones?.despidos || 0) + (d.previsiones?.sac || 0));
  if (montoPrevisiones > 0) {
    const sueldos = lineasFijas.find((l) => l.label === 'Sueldos equipo');
    if (sueldos) sueldos.monto += montoPrevisiones;
    else lineasFijas.push({ label: 'Sueldos equipo', monto: montoPrevisiones, fuente: 'gastos' as const });
  }
  const totalFijos = lineasFijas.reduce((a, l) => a + l.monto, 0);
  const inversion = sumaCats(['inversion_equipamiento', 'inversion_nave3']);
  const masaSalarial = sumaCats(['sueldos']);

  // ── Avisos: lo que hace que el número no cierre ──
  const CATS_POR_STOCK: CategoriaGasto[] = ['insumos', 'cultivos_reventa'];
  const insumosSinAplicar = gastosMes.filter((g) => CATS_POR_STOCK.includes(g.categoria) && g.aplicado_stock !== 'SI');
  if (insumosSinAplicar.length) {
    const monto = insumosSinAplicar.reduce((a, g) => a + num(g.monto), 0);
    avisos.push(`${insumosSinAplicar.length} compra(s) de insumos por $${Math.round(monto).toLocaleString('es-AR')} sin aplicar a Stocks: esa compra no está en el costo de ningún lado.`);
  }
  // Una línea de costo mayor que las ventas del mes no puede ser real: significaría que cada
  // peso vendido costó más de un peso solo en ese renglón. Casi siempre es un gasto con ceros
  // de más, y hasta que alguien lo nota el resultado del mes está mal.
  for (const l of lineasImposibles([...lineasVariable, ...lineasFijas], totalVentas)) {
    avisos.push(`"${l.label}" da $${Math.round(l.monto).toLocaleString('es-AR')}, más que todas las ventas del mes. Revisá si hay un gasto cargado con ceros de más.`);
  }
  if (sinStockFinal) avisos.push(`${sinStockFinal} artículo(s) con movimiento pero sin stock final cargado: su consumo no se puede calcular y falta en el costo variable.`);
  if (sinPrecio) avisos.push(`${sinPrecio} artículo(s) consumidos sin precio de compra conocido: su consumo no se puede valorizar.`);

  // Igual que en el Excel: ventas menos los dos bloques de costo, sin sumar nada aparte.
  // Verificado contra agosto — 22.681.957 − 5.208.704 − 18.507.309 = −1.034.056, exacto.
  const resultado = totalVentas - totalVariable - totalFijos;
  return {
    anio, mes,
    ventas: { total: totalVentas, porCultivo },
    costoVariable: { total: totalVariable, lineas: lineasVariable },
    costosFijos: { total: totalFijos, sinInversion: totalFijos - inversion, lineas: lineasFijas },
    inversion,
    resultado,
    // El resultado sin inversión es el resultado devolviéndole lo gastado en equipamiento:
    // la inversión no es costo de operar, es plata puesta en el negocio. Verificado contra
    // agosto — −1.034.056 + 8.476.004 = 7.441.948, exacto.
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

// ── Qué gastos hay detrás de cada línea del EERR ──────────────────────────────────────
//
// El total de una línea no dice nada por sí solo: "Otros $2.100.000" obliga a abrir la
// planilla y filtrar a mano para saber qué lo compone, que es justo cuando uno quiere
// entender un número que se fue de escala.
//
// Las líneas que salen de Gastos devuelven sus gastos directo. Las que salen de Stocks
// —el consumo valorizado— devuelven las COMPRAS del mes de esos artículos: no son el mismo
// número que la línea (la línea es consumo, no compra) y por eso se dice en la pantalla,
// pero son los movimientos que hay para mirar.
export interface GastoDeLinea {
  id_gasto: string;
  fecha: string;
  descripcion: string;
  monto: number;
  medio_pago: string;
  categoria: string;
}

export function gastosDeLinea(
  gastos: Gasto[], articulos: Articulo[], label: string, anio: number, mes: number,
): { items: GastoDeLinea[]; esCompra: boolean } {
  const mm = String(mes).padStart(2, '0');
  const desde = `${anio}-${mm}-01`;
  const hasta = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
  const delMes = gastos.filter((g) => {
    const f = String(g.fecha || '').split(/[T ]/)[0];
    return f >= desde && f <= hasta;
  });
  const fila = (g: Gasto): GastoDeLinea => ({
    id_gasto: String(g.id_gasto),
    fecha: String(g.fecha || '').split(/[T ]/)[0],
    descripcion: String(g.descripcion || ''),
    monto: num(g.monto),
    medio_pago: String(g.medio_pago || ''),
    categoria: String(g.categoria || ''),
  });
  const ordenar = (xs: GastoDeLinea[]) => xs.sort((a, b) => b.monto - a.monto);

  const fijo = FIJOS.find((f) => f.label === label);
  if (fijo) {
    return { items: ordenar(delMes.filter((g) => fijo.cats.includes(g.categoria)).map(fila)), esCompra: false };
  }

  const variable = LINEAS_VARIABLE.find((l) => l.label === label);
  if (variable?.cat) {
    return { items: ordenar(delMes.filter((g) => g.categoria === variable.cat).map(fila)), esCompra: false };
  }

  if (variable) {
    // Línea de stock: los gastos son las compras de los artículos de esa categoría. La
    // categoría del artículo es texto libre en la planilla, así que se clasifica con la
    // misma función que usa el cálculo — si acá se clasificara distinto, el detalle no
    // correspondería a la línea.
    const deLaLinea = new Set(
      articulos.filter((a) => lineaDeCategoria(a.categoria) === label).map((a) => String(a.id_articulo)),
    );
    return {
      items: ordenar(delMes.filter((g) => deLaLinea.has(String((g as any).id_articulo || ''))).map(fila)),
      esCompra: true,
    };
  }

  return { items: [], esCompra: false };
}

// ── Las ventas del mes abiertas por artículo y por cliente ────────────────────────────
//
// El EERR agrupa las ventas por cultivo, que es lo que hace falta para el resultado. Pero
// cuando un mes se va de escala, la pregunta siguiente siempre es la misma: ¿por qué
// artículo y a qué cliente. Tenerlo acá evita salir a Estadísticas y volver.
//
// Se valoriza con `precioFinal`, el mismo que usa el resto de la app: el precio real de ese
// cliente con el IVA que le corresponde. Un promedio daría otro total que el del EERR, y dos
// totales distintos en la misma pantalla no se pueden defender.
export interface DesgloseVenta { label: string; unidades: number; monto: number }

export function desgloseVentas(d: Omit<DatosEERR, 'previsiones'>, anio: number, mes: number): {
  porArticulo: DesgloseVenta[];
  porCliente: DesgloseVenta[];
} {
  const mm = String(mes).padStart(2, '0');
  const desde = `${anio}-${mm}-01`;
  const hasta = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
  const clienteMap = new Map(d.clientes.map((c) => [String(c.id_control), c]));

  const porArticulo = new Map<string, DesgloseVenta>();
  const porCliente = new Map<string, DesgloseVenta>();

  for (const v of d.ventas) {
    const f = String(v.fecha || '').split(/[T ]/)[0];
    if (!f || f < desde || f > hasta) continue;
    const cli = clienteMap.get(String(v.id_control));
    const nombreCli = nombreClienteVisible(cli) || String(v.id_control);

    for (const art of ARTICULOS) {
      const qty = Number((v as any)[art.key]) || 0;
      if (qty <= 0) continue;
      const monto = qty * precioFinal(d.precios, String(v.id_control), v.sucursal, art.key, cli);

      const a = porArticulo.get(art.label) || { label: art.labelLargo || art.label, unidades: 0, monto: 0 };
      a.unidades += qty; a.monto += monto;
      porArticulo.set(art.label, a);

      const c = porCliente.get(nombreCli) || { label: nombreCli, unidades: 0, monto: 0 };
      c.unidades += qty; c.monto += monto;
      porCliente.set(nombreCli, c);
    }
  }

  const ordenar = (m: Map<string, DesgloseVenta>) =>
    [...m.values()].filter((x) => x.monto > 0 || x.unidades > 0).sort((a, b) => b.monto - a.monto);
  return { porArticulo: ordenar(porArticulo), porCliente: ordenar(porCliente) };
}
