import type { VentaDia, ClienteVenta, PrecioVenta, VentaHistorica, Lote } from './types';
import { nombreClienteVisible } from './clientes';
import { pesoPromedioRango } from './estadisticas';

// Gramos por paquete/planta — mismos defaults que /api/stocks/camara cuando no hay
// pesaje testigo reciente. Se usan acá para poder sumar ventas por KG (cajón) al
// mismo total en unidades que rucula/lechuga_crespa+hoja_roble.
export const GR_PAQ_RUCULA = 210;
export const GR_PAQ_LECHUGA = 330;

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
// lechuga_kg queda (legacy) para no perder ventas por kg cargadas antes del split crespa/roble.
const PROD_KEYS = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'] as const;

function mesKey(fecha: string): string { return String(fecha || '').slice(0, 7); } // YYYY-MM
function mesLabel(mk: string): string {
  const [y, m] = mk.split('-').map(Number);
  return m >= 1 && m <= 12 ? `${MESES_CORTO[m - 1]}-${String(y).slice(2)}` : mk;
}
function ultimosNMeses(ventas: VentaDia[], n: number): string[] {
  const claves = Array.from(new Set(ventas.map((v) => mesKey(v.fecha)).filter((k) => /^\d{4}-\d{2}$/.test(k)))).sort();
  return claves.slice(-n);
}

// Semana = lunes de esa semana, como clave YYYY-MM-DD.
function semanaKey(fecha: string): string {
  const s = String(fecha || '').split(/[T ]/)[0];
  const d = new Date(s + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  const dow = d.getDay(); // 0=dom..6=sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function semanaLabel(sk: string): string {
  const [, m, d] = sk.split('-');
  return `${d}/${m}`;
}
function ultimasNSemanas(ventas: VentaDia[], n: number): string[] {
  const semanaActual = semanaKey(new Date().toISOString().slice(0, 10));
  const claves = Array.from(new Set(ventas.map((v) => semanaKey(v.fecha)).filter(Boolean)))
    .filter((k) => k !== semanaActual) // la semana en curso está incompleta y distorsiona la tendencia
    .sort();
  return claves.slice(-n);
}

// Lee un campo tolerando variantes de mayúsculas/acentos en el header de la planilla
// (p. ej. "Rucula" o "Rúcula" en vez de "rucula").
function campo(obj: Record<string, any>, ...nombres: string[]): any {
  for (const n of nombres) if (obj[n] !== undefined && obj[n] !== '') return obj[n];
  const keys = Object.keys(obj);
  for (const n of nombres) {
    const k = keys.find((kk) => kk.trim().toLowerCase() === n.toLowerCase());
    if (k && obj[k] !== undefined && obj[k] !== '') return obj[k];
  }
  return undefined;
}

// Acepta "2026-06", "2026/6" o el mismo formato "jun-26" que se usa en las etiquetas
// del gráfico (y que es lo más natural para tipear a mano en VentasHistoricas).
function normalizarMesHistorico(raw: any): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}`;
  const m2 = s.match(/^([a-záéíóúñ]+)[-/\s]+(\d{2,4})$/);
  if (m2) {
    const idx = MESES_CORTO.findIndex((mc) => mc.startsWith(m2[1]) || m2[1].startsWith(mc));
    if (idx >= 0) {
      const yy = m2[2].length === 4 ? m2[2].slice(2) : m2[2];
      return `20${yy}-${String(idx + 1).padStart(2, '0')}`;
    }
  }
  return null;
}

function getPrecio(precios: PrecioVenta[], id_control: string, sucursal: string, key: string, clienteSucursales?: string): number {
  let row = precios.find((p) => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal);
  if (!row && clienteSucursales) {
    for (const s of clienteSucursales.split('|').map((x) => x.trim()).filter(Boolean)) {
      row = precios.find((p) => String(p.id_control) === String(id_control) && p.sucursal_obs === s);
      if (row) break;
    }
  }
  if (!row) row = precios.find((p) => String(p.id_control) === String(id_control));
  if (!row) return 0;
  return Number((row as any)[key] || 0);
}

// Precio final que cobra el cliente (IVA incluido). En Factura A el precio cargado en
// la planilla es neto (se le suma 10,5% de IVA); en Factura B el precio cargado ya es
// el final, no se le suma nada.
const IVA_FACTURA_A = 1.105;
export function precioFinal(precios: PrecioVenta[], id_control: string, sucursal: string, key: string, cliente?: ClienteVenta): number {
  const base = getPrecio(precios, id_control, sucursal, key, cliente?.sucursales);
  return cliente?.tipo_factura === 'A' ? base * IVA_FACTURA_A : base;
}

// ── Evolución de venta por artículo (unidades: paquetes de rúcula, plantas de lechuga/albahaca) ──
// proy* es SOLO lo que falta para llegar a la proyección de fin de mes (no el total
// proyectado) — así el gráfico lo apila arriba de lo real y queda como el faltante hueco.
// Siempre 0 salvo en el mes en curso (y no en uno cargado a mano en VentasHistoricas: ese
// ya es un cierre, no hay nada "por venir").
export interface PuntoArticulo {
  mes: string; label: string; rucula: number; lechuga: number; albahaca: number;
  proyRucula: number; proyLechuga: number; proyAlbahaca: number;
}
export function evolucionVentaPorArticulo(ventas: VentaDia[], n = 12, historicas: VentaHistorica[] = [], fechaRef: Date = new Date()): PuntoArticulo[] {
  const historicasNorm = historicas
    .map((h) => ({
      mes: normalizarMesHistorico(campo(h as any, 'mes', 'Mes', 'MES')),
      rucula: Number(campo(h as any, 'rucula', 'Rucula', 'Rúcula', 'RUCULA')) || 0,
      lechuga: Number(campo(h as any, 'lechuga', 'Lechuga', 'Lechugas', 'LECHUGA')) || 0,
    }))
    .filter((h): h is { mes: string; rucula: number; lechuga: number } => !!h.mes);

  const claves = Array.from(new Set([
    ...ventas.map((v) => mesKey(v.fecha)).filter((k) => /^\d{4}-\d{2}$/.test(k)),
    ...historicasNorm.map((h) => h.mes),
  ])).sort();
  const meses = claves.slice(-n);
  const historicasPorMes = new Map(historicasNorm.map((h) => [h.mes, h]));

  // Mismo criterio de prorrateo que resumenMesActual: por días de venta habituales, no por
  // días de calendario (si no, la proyección se desploma cada fin de semana). Se calcula acá
  // afuera del .map porque solo hace falta una vez, para el único mes que la usa.
  const mesActual = mesKey(fechaRef.toISOString().slice(0, 10));
  const diasVentaSemana = diasDeVentaHabituales(ventas);

  return meses.map((mes) => {
    const historica = historicasPorMes.get(mes);
    if (historica) {
      return { mes, label: mesLabel(mes), rucula: Number(historica.rucula) || 0, lechuga: Number(historica.lechuga) || 0, albahaca: 0, proyRucula: 0, proyLechuga: 0, proyAlbahaca: 0 };
    }
    const delMes = ventas.filter((v) => mesKey(v.fecha) === mes);
    const ruculaKgEnPaq = delMes.reduce((a, v) => a + (Number(v.rucula_kg) || 0), 0) * 1000 / GR_PAQ_RUCULA;
    const lechugaKgEnPaq = delMes.reduce((a, v) => a + (Number(v.lechuga_kg) || 0) + (Number(v.lechuga_kg_crespa) || 0) + (Number(v.lechuga_kg_roble) || 0), 0) * 1000 / GR_PAQ_LECHUGA;
    const rucula = delMes.reduce((a, v) => a + (Number(v.rucula) || 0) + (Number(v.bandeja_rucula) || 0), 0) + Math.round(ruculaKgEnPaq);
    const lechuga = delMes.reduce((a, v) => a + (Number(v.lechuga_crespa) || 0) + (Number(v.hoja_roble) || 0), 0) + Math.round(lechugaKgEnPaq);
    const albahaca = delMes.reduce((a, v) => a + (Number(v.albahaca) || 0), 0);

    if (mes !== mesActual) return { mes, label: mesLabel(mes), rucula, lechuga, albahaca, proyRucula: 0, proyLechuga: 0, proyAlbahaca: 0 };

    const corte = fechaRef.getDate();
    const diasEnMes = new Date(fechaRef.getFullYear(), fechaRef.getMonth() + 1, 0).getDate();
    const cuentaDiasVenta = (desde: number, hasta: number) => {
      let cnt = 0;
      for (let d = desde; d <= hasta; d++) if (diasVentaSemana.has(new Date(fechaRef.getFullYear(), fechaRef.getMonth(), d).getDay())) cnt++;
      return cnt;
    };
    const transcurridos = cuentaDiasVenta(1, corte);
    const delMesDias = cuentaDiasVenta(1, diasEnMes);
    const factor = transcurridos > 0 && delMesDias > 0 ? delMesDias / transcurridos : (corte > 0 ? diasEnMes / corte : 1);
    return {
      mes, label: mesLabel(mes), rucula, lechuga, albahaca,
      proyRucula: Math.max(0, Math.round(rucula * factor) - rucula),
      proyLechuga: Math.max(0, Math.round(lechuga * factor) - lechuga),
      proyAlbahaca: Math.max(0, Math.round(albahaca * factor) - albahaca),
    };
  });
}

// ── Evolución de venta por cliente (unidades totales, top N) — mensual o semanal ──
export interface SerieCliente { id_control: string; nombre: string; total: number }
export interface EvolucionClientes { meses: { mes: string; label: string }[]; series: SerieCliente[]; puntos: Record<string, number>[] }

export function evolucionVentaPorCliente(ventas: VentaDia[], clientes: ClienteVenta[], n = 12, topN = 6): EvolucionClientes {
  const mesesKeys = ultimosNMeses(ventas, n);
  return construirEvolucionCliente(ventas, clientes, mesesKeys, mesLabel, mesKey, topN);
}

export function evolucionVentaPorClienteSemanal(ventas: VentaDia[], clientes: ClienteVenta[], n = 10, topN = 6): EvolucionClientes {
  const semanasKeys = ultimasNSemanas(ventas, n);
  return construirEvolucionCliente(ventas, clientes, semanasKeys, semanaLabel, semanaKey, topN);
}

function construirEvolucionCliente(
  ventas: VentaDia[], clientes: ClienteVenta[], claves: string[], etiqueta: (k: string) => string, keyFn: (fecha: string) => string, topN: number
): EvolucionClientes {
  const meses = claves.map((k) => ({ mes: k, label: etiqueta(k) }));
  const porCliente = new Map<string, Record<string, number>>();
  for (const v of ventas) {
    const k = keyFn(v.fecha);
    if (!claves.includes(k)) continue;
    // Los campos _kg (venta por cajón) se convierten a paquete/planta-equivalente antes
    // de sumar — si no, un cliente que compra 50kg quedaba con "total" = 50, invisible
    // al lado de clientes que compran cientos/miles de paquetes, aunque en volumen real
    // fuera un cliente grande. Antes esto directamente los sacaba del top N del gráfico.
    const total = PROD_KEYS.reduce((a, kk) => {
      const qty = Number((v as any)[kk]) || 0;
      if (qty <= 0) return a;
      if (kk === 'rucula_kg') return a + (qty * 1000) / GR_PAQ_RUCULA;
      if (kk === 'lechuga_kg' || kk === 'lechuga_kg_crespa' || kk === 'lechuga_kg_roble') return a + (qty * 1000) / GR_PAQ_LECHUGA;
      return a + qty;
    }, 0);
    if (total <= 0) continue;
    if (!porCliente.has(v.id_control)) porCliente.set(v.id_control, {});
    const rec = porCliente.get(v.id_control)!;
    rec[k] = (rec[k] || 0) + total;
  }
  const nombreMap = new Map(clientes.map((c) => [c.id_control, nombreClienteVisible(c)]));
  const entradas = Array.from(porCliente.entries()).map(([id_control, valores]) => ({
    id_control, nombre: nombreMap.get(id_control) || id_control, valores,
    total: Object.values(valores).reduce((a, b) => a + b, 0),
  })).sort((a, b) => b.total - a.total).slice(0, topN);

  const series = entradas.map((e) => ({ id_control: e.id_control, nombre: e.nombre, total: e.total }));
  const puntos = claves.map((k) => {
    const punto: Record<string, number> = {};
    for (const e of entradas) punto[e.id_control] = e.valores[k] || 0;
    return punto;
  });
  return { meses, series, puntos };
}

// ── Evolución del precio promedio de venta (ARS final, IVA incluido, ponderado por unidades) — rúcula y lechuga por separado ──
// Solo se promedian ventas en la misma unidad (paquete/planta). Se excluyen bandeja_rucula,
// rucula_kg y lechuga_kg: son otra unidad de venta (bandeja o kg) con precio no comparable
// al de paquete/planta, y mezclarlos en el mismo promedio ponderado lo distorsiona hacia arriba.
const KEYS_RUCULA = ['rucula'] as const;
const KEYS_LECHUGA = ['lechuga_crespa', 'hoja_roble'] as const;
export interface PuntoPrecio { mes: string; label: string; precioRucula: number; precioLechuga: number }
export function evolucionPrecioPromedio(ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], n = 12): PuntoPrecio[] {
  const meses = ultimosNMeses(ventas, n);
  const clienteMap = new Map(clientes.map((c) => [c.id_control, c]));

  const promedioPonderado = (delMes: VentaDia[], keys: readonly string[]) => {
    let ingresos = 0, unidades = 0;
    for (const v of delMes) {
      const cliente = clienteMap.get(v.id_control);
      for (const key of keys) {
        const qty = Number((v as any)[key]) || 0;
        if (qty <= 0) continue;
        ingresos += qty * precioFinal(precios, v.id_control, v.sucursal, key, cliente);
        unidades += qty;
      }
    }
    return unidades > 0 ? Math.round((ingresos / unidades) * 100) / 100 : 0;
  };

  return meses.map((mes) => {
    const delMes = ventas.filter((v) => mesKey(v.fecha) === mes);
    return {
      mes, label: mesLabel(mes),
      precioRucula: promedioPonderado(delMes, KEYS_RUCULA),
      precioLechuga: promedioPonderado(delMes, KEYS_LECHUGA),
    };
  });
}

// ── Resumen de un mes: unidades vendidas, proyección (por proporción del mes
// transcurrido) y precio promedio — para la tarjeta de Indicadores.
// `fechaRef` fija el mes objetivo (por defecto hoy); `diaCorte` permite recortar ese mes
// hasta un día puntual (para comparar "lo que va del mes" contra el mismo tramo del mes
// pasado). Sin diaCorte usa el día de fechaRef (o el mes completo si fechaRef ya pasó).
// Días de la semana (0=domingo..6=sábado) en los que efectivamente se vende, deducidos de
// las ventas cargadas. Se pide un mínimo de días con venta para considerar que ese día de
// la semana es "de reparto" y no una excepción suelta (una entrega puntual un domingo no
// debería agregar los domingos al prorrateo de todo el mes). Si no hay datos suficientes
// devuelve el set vacío y quien llama cae al prorrateo por días calendario de siempre.
const MIN_DIAS_PARA_CONTAR = 2;
export function diasDeVentaHabituales(ventas: VentaDia[]): Set<number> {
  const fechasPorDow = new Map<number, Set<string>>();
  for (const v of ventas) {
    const f = String(v.fecha || '').split(/[T ]/)[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) continue;
    const d = new Date(f + 'T12:00:00');
    if (isNaN(d.getTime())) continue;
    const dow = d.getDay();
    if (!fechasPorDow.has(dow)) fechasPorDow.set(dow, new Set());
    fechasPorDow.get(dow)!.add(f);
  }
  const out = new Set<number>();
  for (const [dow, fechas] of fechasPorDow) if (fechas.size >= MIN_DIAS_PARA_CONTAR) out.add(dow);
  return out;
}

// ── Clientes: precio promedio vs. volumen (para el gráfico de dispersión) ──
// Cada cliente es un punto: X = lo que paga en promedio por unidad, Y = cuánto compró.
// Sirve para ver de un vistazo quién compra mucho barato (abajo a la izquierda no
// preocupa; ARRIBA a la izquierda sí: mucho volumen a precio bajo) y quién paga bien.
//
// La ventana es MÓVIL (últimos `dias` hasta `hasta`), no el mes calendario: a principio de
// mes el mes en curso tiene 3 o 4 días cargados y el gráfico quedaba vacío o con un cliente
// suelto arriba de todo. De paso resuelve solo el otro problema: un cliente que hace más de
// un mes que no compra directamente no tiene ventas en la ventana y no aparece — antes se
// arrastraba con el volumen de un mes viejo como si siguiera activo.
//
// Los clientes que compran por KG entran igual: los kilos se pasan a unidades-equivalente
// con el PESO REAL de las plantas cosechadas en la misma ventana (pesoPromedioRango), no
// con el gramaje fijo de la app, y de ahí sale a qué precio por unidad se les estaría
// vendiendo. Antes quedaban afuera del gráfico por no tener un precio comparable — y son
// justo los de más volumen, que es lo que hay que mirar.
//
// La bandeja sí queda afuera del precio promedio (es otra presentación, con su propio
// precio, que no se compara contra un paquete suelto), aunque suma al volumen.
export interface ClientePrecioVolumen {
  id_control: string;
  nombre: string;
  unidades: number;       // volumen de la ventana (todas las presentaciones, kg convertido)
  precioPromedio: number; // $ por unidad comparable (IVA incluido)
  monto: number;          // facturado en la ventana
}
export function clientesPrecioVsVolumen(
  ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], lotes: Lote[] = [], hasta: Date = new Date(), dias = 30
): ClientePrecioVolumen[] {
  const fmtDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hastaStr = fmtDia(hasta);
  const desdeD = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
  desdeD.setDate(desdeD.getDate() - (dias - 1));
  const desdeStr = fmtDia(desdeD);
  const clienteMap = new Map(clientes.map((c) => [c.id_control, c]));
  const nombreMap = new Map(clientes.map((c) => [String(c.id_control), nombreClienteVisible(c)]));
  const PRICE_KEYS = [...KEYS_RUCULA, ...KEYS_LECHUGA, 'albahaca'] as const;
  const KEYS_KG = ['rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'] as const;

  // Gramos por unidad para convertir los kilos, tomados de lo REALMENTE cosechado en la
  // misma ventana: si las plantas vienen más chicas, el mismo kilo son más unidades y el
  // precio por unidad que paga ese cliente baja. Sin cosechas en la ventana (o sin lotes,
  // que es como la llaman los tests) cae al gramaje fijo de siempre.
  const peso = pesoPromedioRango(lotes, desdeD, hasta);
  const gramosDe = (key: string): number => {
    if (key === 'rucula_kg') return peso.rucula > 0 ? peso.rucula : GR_PAQ_RUCULA;
    if (key === 'lechuga_kg_crespa') return peso.lechugaCrespa > 0 ? peso.lechugaCrespa : GR_PAQ_LECHUGA;
    if (key === 'lechuga_kg_roble') return peso.lechugaRoble > 0 ? peso.lechugaRoble : GR_PAQ_LECHUGA;
    return peso.lechuga > 0 ? peso.lechuga : GR_PAQ_LECHUGA; // lechuga_kg legado, sin split
  };

  const acc = new Map<string, { unidades: number; monto: number; ingComparable: number; uComparable: number }>();
  for (const v of ventas) {
    const f = String(v.fecha || '').split(/[T ]/)[0];
    if (!f || f < desdeStr || f > hastaStr) continue;
    const id = String(v.id_control || '');
    if (!id) continue;
    const cliente = clienteMap.get(v.id_control);
    if (!acc.has(id)) acc.set(id, { unidades: 0, monto: 0, ingComparable: 0, uComparable: 0 });
    const a = acc.get(id)!;
    for (const key of PROD_KEYS) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      const precio = precioFinal(precios, v.id_control, v.sucursal, key, cliente);
      a.monto += qty * precio;
      if ((KEYS_KG as readonly string[]).includes(key)) {
        // qty son KILOS: se pasan a unidades-equivalente con el peso real de la ventana, y
        // el mismo importe dividido por esas unidades da el precio por unidad equivalente.
        const uEquivalentes = (qty * 1000) / gramosDe(key);
        a.unidades += uEquivalentes;
        a.ingComparable += qty * precio;
        a.uComparable += uEquivalentes;
      } else {
        a.unidades += qty;
        if ((PRICE_KEYS as readonly string[]).includes(key)) {
          a.ingComparable += qty * precio;
          a.uComparable += qty;
        }
      }
    }
  }

  const out: ClientePrecioVolumen[] = [];
  for (const [id, a] of acc) {
    const unidades = Math.round(a.unidades);
    if (unidades <= 0) continue;
    // Solo queda afuera un cliente que no tenga NINGUNA venta valorizable (ej. todo en
    // bandeja sin precio cargado): sin eso el punto iría a $0 y rompería la escala del eje.
    if (a.uComparable <= 0 || a.ingComparable <= 0) continue;
    out.push({
      id_control: id,
      nombre: nombreMap.get(id) || id,
      unidades,
      precioPromedio: Math.round((a.ingComparable / a.uComparable) * 100) / 100,
      monto: Math.round(a.monto),
    });
  }
  return out.sort((x, y) => y.unidades - x.unidades);
}

export interface ResumenMesActual {
  unidadesMes: number; proyeccionMes: number; precioPromedioMes: number;
  // Facturado del mes hasta el corte y su proyección a fin de mes, con el MISMO prorrateo
  // por días de venta que las unidades. Se valoriza cada línea con el precio real de ese
  // cliente (IVA incluido según su tipo de factura), incluidas las ventas por kg y las
  // bandejas — no es unidades × precio promedio, que se desviaría según el mix.
  montoMes: number; proyeccionMonto: number;
}
export function resumenMesActual(
  ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], fechaRef: Date = new Date(), diaCorte?: number
): ResumenMesActual {
  const mk = mesKey(fechaRef.toISOString().slice(0, 10));
  const corte = diaCorte ?? fechaRef.getDate();
  const delMes = ventas.filter((v) => {
    if (mesKey(v.fecha) !== mk) return false;
    const dia = Number(String(v.fecha).split(/[T ]/)[0].split('-')[2]);
    return !dia || dia <= corte;
  });
  const clienteMap = new Map(clientes.map((c) => [c.id_control, c]));

  const PRICE_KEYS = [...KEYS_RUCULA, ...KEYS_LECHUGA, 'albahaca'] as const;
  // rucula_kg/lechuga_kg (ventas por cajón) quedan afuera del precio promedio (otra unidad
  // de venta, no comparable a paquete/planta — mismo motivo que evolucionPrecioPromedio),
  // pero SÍ suman a "unidades" convertidas a paquete-equivalente (mismo criterio y mismos
  // factores que el gráfico "Evolución de venta por artículo") para que ambos totales
  // coincidan. Se convierte una sola vez sobre el total del mes (no por venta individual)
  // para no arrastrar error de redondeo fila por fila.
  const KEYS_KG_UNIDADES = ['rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'] as const;
  let unidades = 0, ingresosComparables = 0, unidadesComparables = 0;
  let ruculaKgTotal = 0, lechugaKgTotal = 0;
  let monto = 0; // facturado total del mes, TODAS las presentaciones (incluye kg y bandeja)
  for (const v of delMes) {
    const cliente = clienteMap.get(v.id_control);
    for (const key of PROD_KEYS) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      // El monto se valoriza siempre, con el precio de ESA presentación para ESE cliente:
      // las ventas por kg tienen su propio precio por kg, así que entran acá aunque queden
      // afuera del precio promedio por unidad de más abajo.
      monto += qty * precioFinal(precios, v.id_control, v.sucursal, key, cliente);
      if ((KEYS_KG_UNIDADES as readonly string[]).includes(key)) {
        if (key === 'rucula_kg') ruculaKgTotal += qty;
        else lechugaKgTotal += qty; // lechuga_kg (legacy) + lechuga_kg_crespa + lechuga_kg_roble
      } else {
        unidades += qty;
      }
      if ((PRICE_KEYS as readonly string[]).includes(key)) {
        ingresosComparables += qty * precioFinal(precios, v.id_control, v.sucursal, key, cliente);
        unidadesComparables += qty;
      }
    }
  }
  unidades += Math.round((ruculaKgTotal * 1000) / GR_PAQ_RUCULA) + Math.round((lechugaKgTotal * 1000) / GR_PAQ_LECHUGA);

  // Proyección a fin de mes. Antes era (unidades / díasCalendarioTranscurridos) × díasDelMes,
  // y eso hacía que el número subiera y bajara fuerte de un día para el otro: los domingos
  // (y cualquier día sin reparto) no se vende, pero igual sumaban al divisor, así que cada
  // fin de semana la proyección se desplomaba y el lunes volvía a saltar.
  // Ahora el prorrateo se hace sobre DÍAS DE VENTA: los días de la semana en los que
  // realmente se factura, deducidos de las ventas de los últimos meses en vez de estar
  // fijos (si mañana se agrega o saca un día de reparto, se ajusta solo).
  const diasEnMes = new Date(fechaRef.getFullYear(), fechaRef.getMonth() + 1, 0).getDate();
  const diasVentaSemana = diasDeVentaHabituales(ventas);
  const cuentaDiasVenta = (desde: number, hasta: number) => {
    let n = 0;
    for (let d = desde; d <= hasta; d++) {
      if (diasVentaSemana.has(new Date(fechaRef.getFullYear(), fechaRef.getMonth(), d).getDay())) n++;
    }
    return n;
  };
  const diasVentaTranscurridos = cuentaDiasVenta(1, corte);
  const diasVentaDelMes = cuentaDiasVenta(1, diasEnMes);
  const factorProyeccion = diasVentaTranscurridos > 0 && diasVentaDelMes > 0
    ? diasVentaDelMes / diasVentaTranscurridos
    : (corte > 0 ? diasEnMes / corte : 0);
  const proyeccionMes = Math.round(unidades * factorProyeccion);
  const proyeccionMonto = Math.round(monto * factorProyeccion);
  // Precio promedio final (IVA incluido): solo ventas por paquete/planta (mismo criterio
  // que evolucionPrecioPromedio) — mezclar bandeja/kg inflaba el promedio al combinar
  // unidades de venta distintas.
  const precioPromedioMes = unidadesComparables > 0 ? Math.round((ingresosComparables / unidadesComparables) * 100) / 100 : 0;
  return { unidadesMes: unidades, proyeccionMes, precioPromedioMes, montoMes: Math.round(monto), proyeccionMonto };
}

// ── Ventas por cultivo (unidades y $ final IVA incluido) en un rango de fechas [desde,hasta]
// inclusive (YYYY-MM-DD) — para el reporte semanal. Kg convertidos a paquete-equivalente. ──
// `unidades` es el TOTAL (directas + kg convertidos a paquete-equivalente) — es lo que se
// usa para medir volumen de venta. Pero para insumos de packaging esa mezcla no sirve: una
// venta por kg va en cajón, NO lleva bolsa individual, y una bandeja lleva su propia
// bandeja en vez de bolsa. Por eso se guardan además desagregadas las dos partes que NO
// consumen bolsa, y así "paquetes embolsados" = unidades − unidadesKg − unidadesBandeja
// (ver los drivers *_bolsa / *_sin_kg en lib/usoTeorico.ts).
export interface VentasRangoCultivo {
  unidades: number; monto: number;
  unidadesKg: number;      // parte del total que vino de ventas por kg (cajón — sin packaging individual)
  unidadesBandeja: number; // solo rúcula: bandejas (packaging propio, no bolsa). Siempre 0 en lechuga.
}
// Albahaca va aparte: no es lechuga (antes directamente no se contaba en este rango, así
// que su venta no aparecía en ningún total que saliera de acá).
export interface VentasRango { rucula: VentasRangoCultivo; lechuga: VentasRangoCultivo; albahaca: VentasRangoCultivo }
export function ventasEnRango(ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], desde: string, hasta: string): VentasRango {
  const clienteMap = new Map(clientes.map((c) => [c.id_control, c]));
  const acc: VentasRango = {
    rucula: { unidades: 0, monto: 0, unidadesKg: 0, unidadesBandeja: 0 },
    lechuga: { unidades: 0, monto: 0, unidadesKg: 0, unidadesBandeja: 0 },
    albahaca: { unidades: 0, monto: 0, unidadesKg: 0, unidadesBandeja: 0 },
  };
  for (const v of ventas) {
    const f = String(v.fecha || '').split(/[T ]/)[0];
    if (!f || f < desde || f > hasta) continue;
    const cliente = clienteMap.get(v.id_control);

    for (const key of ['rucula', 'bandeja_rucula'] as const) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      acc.rucula.unidades += qty;
      if (key === 'bandeja_rucula') acc.rucula.unidadesBandeja += qty;
      acc.rucula.monto += qty * precioFinal(precios, v.id_control, v.sucursal, key, cliente);
    }
    const kgR = Number(v.rucula_kg) || 0;
    if (kgR > 0) {
      const enPaq = Math.round((kgR * 1000) / GR_PAQ_RUCULA);
      acc.rucula.unidades += enPaq;
      acc.rucula.unidadesKg += enPaq;
      acc.rucula.monto += kgR * precioFinal(precios, v.id_control, v.sucursal, 'rucula_kg', cliente);
    }

    for (const key of ['lechuga_crespa', 'hoja_roble'] as const) {
      const qty = Number((v as any)[key]) || 0;
      if (qty <= 0) continue;
      acc.lechuga.unidades += qty;
      acc.lechuga.monto += qty * precioFinal(precios, v.id_control, v.sucursal, key, cliente);
    }
    // lechuga_kg (legacy) + lechuga_kg_crespa/lechuga_kg_roble (split por variedad) — cada
    // uno con su propio precio, todos suman al mismo total de lechuga.
    for (const keyKg of ['lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'] as const) {
      const kgL = Number((v as any)[keyKg]) || 0;
      if (kgL <= 0) continue;
      const enPaq = Math.round((kgL * 1000) / GR_PAQ_LECHUGA);
      acc.lechuga.unidades += enPaq;
      acc.lechuga.unidadesKg += enPaq;
      acc.lechuga.monto += kgL * precioFinal(precios, v.id_control, v.sucursal, keyKg, cliente);
    }
    // Albahaca: solo por unidad (no hay albahaca_kg ni bandeja).
    const qtyAlb = Number(v.albahaca) || 0;
    if (qtyAlb > 0) {
      acc.albahaca.unidades += qtyAlb;
      acc.albahaca.monto += qtyAlb * precioFinal(precios, v.id_control, v.sucursal, 'albahaca', cliente);
    }
  }
  acc.rucula.monto = Math.round(acc.rucula.monto);
  acc.lechuga.monto = Math.round(acc.lechuga.monto);
  acc.albahaca.monto = Math.round(acc.albahaca.monto);
  return acc;
}

function lunesDeSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}
const fmtISOLocal = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// ── Ventas por cultivo (unidades), últimas N semanas CALENDARIO completas (lunes a
// domingo, terminando el domingo pasado — la semana en curso queda afuera por estar
// incompleta). A diferencia de evolucionVentaPorArticuloSemanal, no depende de qué
// semanas tengan ventas cargadas: si hubo un hueco de carga, esa semana simplemente
// aparece en 0 en vez de saltarse silenciosamente a semanas más viejas para completar N,
// lo que corría las etiquetas y hacía parecer "actual" un dato de varios meses atrás. ──
export interface PuntoVentaCultivoSemana { semana: string; label: string; rucula: number; lechuga: number }
export function ventasPorCultivoUltimasSemanas(
  ventas: VentaDia[], precios: PrecioVenta[], clientes: ClienteVenta[], n = 4
): PuntoVentaCultivoSemana[] {
  const lunesActual = lunesDeSemana(new Date());
  const puntos: PuntoVentaCultivoSemana[] = [];
  for (let i = n; i >= 1; i--) {
    const lunes = new Date(lunesActual); lunes.setDate(lunes.getDate() - i * 7);
    const domingo = new Date(lunes); domingo.setDate(domingo.getDate() + 6);
    const desde = fmtISOLocal(lunes), hasta = fmtISOLocal(domingo);
    const r = ventasEnRango(ventas, precios, clientes, desde, hasta);
    puntos.push({ semana: desde, label: `${String(lunes.getDate()).padStart(2, '0')}/${String(lunes.getMonth() + 1).padStart(2, '0')}`, rucula: r.rucula.unidades, lechuga: r.lechuga.unidades });
  }
  return puntos;
}

// ── Ventas cargadas de la semana en curso (lunes → hoy), agrupadas por día y por
// cliente — para el recuadro de "Ventas de esta semana" en la carga diaria. Incluye
// todo lo cargado (facturado o no), a diferencia de facturadasHoy que solo trae lo ya
// exportado. Los días futuros de la semana (aún no llegan) y los días sin ninguna
// carga se omiten, para no mostrar filas vacías sin valor informativo. ──
const DOW_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export interface ClienteDiaCargado { nombre: string; totalPaq: number; totalKg: number }
export interface DiaCargado { fecha: string; label: string; clientes: ClienteDiaCargado[]; totalPaqDia: number; totalKgDia: number }
export function ventasCargadasSemana(ventas: VentaDia[], clientes: ClienteVenta[], hoy: Date = new Date()): DiaCargado[] {
  const nombreMap = new Map(clientes.map((c) => [c.id_control, nombreClienteVisible(c)]));
  const lunes = lunesDeSemana(hoy);
  const hoyStr = fmtISOLocal(hoy);
  const KEYS_PAQ = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca'] as const;
  const KEYS_KG = ['rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'] as const;
  const dias: DiaCargado[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(lunes); d.setDate(lunes.getDate() + i);
    const fecha = fmtISOLocal(d);
    if (fecha > hoyStr) break;
    const porCliente = new Map<string, ClienteDiaCargado>();
    for (const v of ventas) {
      if (String(v.fecha || '').split(/[T ]/)[0] !== fecha) continue;
      const totalPaq = KEYS_PAQ.reduce((a, k) => a + (Number((v as any)[k]) || 0), 0);
      const totalKg = KEYS_KG.reduce((a, k) => a + (Number((v as any)[k]) || 0), 0);
      if (totalPaq <= 0 && totalKg <= 0) continue;
      const nombre = nombreMap.get(v.id_control) || v.nombre_cliente || v.id_control;
      const prev = porCliente.get(nombre) || { nombre, totalPaq: 0, totalKg: 0 };
      prev.totalPaq += totalPaq; prev.totalKg += totalKg;
      porCliente.set(nombre, prev);
    }
    if (porCliente.size === 0) continue;
    const clientesDia = Array.from(porCliente.values()).sort((a, b) => b.totalPaq - a.totalPaq);
    dias.push({
      fecha,
      label: `${DOW_LARGO[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`,
      clientes: clientesDia,
      totalPaqDia: clientesDia.reduce((a, c) => a + c.totalPaq, 0),
      totalKgDia: clientesDia.reduce((a, c) => a + c.totalKg, 0),
    });
  }
  return dias;
}
