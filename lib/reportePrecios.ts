// ── El reporte mensual de precios por cliente ────────────────────────────────────────
//
// Para qué sirve: decidir a quién hay que aumentarle. Esa decisión necesita dos cosas al
// lado, y hasta ahora estaban en pantallas distintas — cuánto compra el cliente y cuándo
// fue la última vez que se le subió. Un cliente grande con ocho meses sin aumento es un
// problema caro; uno chico al que se le subió el mes pasado no es ninguno.
//
// Por eso va ordenado por volumen y no por fecha del aumento: la lista tiene que empezar
// por donde más pesa cada punto de porcentaje.
//
// ── Qué significa "el monto del aumento" ──
//
// Un aumento no tiene un monto único: es un precio nuevo por cada producto. Preguntar
// "¿cuánto le aumentamos?" tiene dos respuestas útiles y distintas, y van las dos:
//
//  · el porcentaje promedio, ponderado por lo que ese cliente compra de cada producto —no
//    el promedio simple, que le daría el mismo peso a la albahaca que compra una vez al mes
//    que a la rúcula que se lleva todos los días;
//
//  · cuánta plata por mes agregó ese aumento, calculada aplicando la diferencia de precio
//    al volumen real del cliente. Es el número que dice si el aumento movió la aguja.
//
// El segundo es una ESTIMACIÓN y está dicho así en el mail: usa el volumen de los últimos
// 30 días, que no es necesariamente el que tenía cuando se aumentó.

import type { CambioPrecio } from './preciosHistorico';

export interface ProductoDelAumento {
  producto: string;
  anterior: number;
  nuevo: number;
  diferencia: number;
  variacionPct: number;
}

export interface FilaReportePrecios {
  id_control: string;
  nombre: string;
  // Volumen de la ventana, para ordenar y para estimar el impacto.
  monto: number;
  unidades: number;
  // La última suba. null cuando nunca se le registró una: puede ser un cliente nuevo o uno
  // al que de verdad nunca se le aumentó, y las dos cosas se ven igual desde acá. Se dice
  // "sin registro", no "nunca": el historial empezó a llenarse en algún momento.
  ultimaSuba: {
    fecha: string;
    diasDesde: number;
    pctPromedio: number;
    // Lo que ese aumento agrega por mes al volumen de hoy. Estimado.
    impactoMensual: number;
    productos: ProductoDelAumento[];
  } | null;
  // Los precios que se le están cobrando hoy, por producto.
  preciosHoy: { producto: string; precio: number }[];
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Días entre dos fechas ISO. Mediodía para que el cambio de horario no corra un día.
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`), b = Date.parse(`${hasta}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// ── Todos los productos que subieron EN LA ÚLTIMA SUBA ───────────────────────────────
//
// No es "el último cambio de cada producto": es la tanda. Un aumento se carga de una vez y
// toca varios productos el mismo día, y lo que se quiere saber es qué pasó ESE día.
//
// Dos cosas que se aprendieron antes y se respetan acá (ver preciosHistorico.ts): con dos
// cambios del mismo producto el mismo día vale el último, desempatando por id_cambio; y
// solo cuentan las subas reales, porque una baja o una corrección no son "el último
// aumento".
export function ultimaTandaDeSuba(
  historial: CambioPrecio[],
  idControl: string,
): { fecha: string; productos: ProductoDelAumento[] } | null {
  const mias = (historial || []).filter((c) => String(c.id_control).trim() === String(idControl).trim());

  // La fecha de la última suba real.
  let fecha = '';
  for (const c of mias) {
    const a = num(c.precio_anterior), n = num(c.precio_nuevo);
    if (!(n > a) || !(a > 0)) continue;
    const f = soloFecha(c.fecha);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) continue;
    if (f > fecha) fecha = f;
  }
  if (!fecha) return null;

  // Todo lo que cambió ese día, quedándose con el último valor de cada producto. Entran
  // también las bajas de ese mismo día: si una tanda subió cinco productos y bajó uno,
  // mostrar solo las subas diría que el cliente pagó más de lo que pagó.
  const porProducto = new Map<string, { c: CambioPrecio; orden: number }>();
  for (const c of mias) {
    if (soloFecha(c.fecha) !== fecha) continue;
    const prod = String(c.producto || '').trim();
    if (!prod) continue;
    const orden = (() => { const n = parseInt(String(c.id_cambio || '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : 0; })();
    const prev = porProducto.get(prod);
    if (prev && prev.orden > orden) continue;
    porProducto.set(prod, { c, orden });
  }

  const productos: ProductoDelAumento[] = [];
  for (const [producto, { c }] of porProducto) {
    const anterior = num(c.precio_anterior), nuevo = num(c.precio_nuevo);
    if (anterior === nuevo) continue;
    productos.push({
      producto, anterior, nuevo,
      diferencia: Math.round((nuevo - anterior) * 100) / 100,
      variacionPct: anterior > 0 ? Math.round(((nuevo - anterior) / anterior) * 1000) / 10 : 0,
    });
  }
  productos.sort((a, b) => b.variacionPct - a.variacionPct);
  return productos.length ? { fecha, productos } : null;
}

// Cuánto compró el cliente de cada producto en la ventana. Es lo que pondera el porcentaje
// y lo que convierte la diferencia de precio en plata por mes.
export type VolumenPorProducto = Map<string, number>;

// ── El porcentaje que de verdad le tocó al cliente ───────────────────────────────────
//
// Ponderado por lo que compra: subirle 30% a la albahaca que lleva una vez por mes y 5% a
// la rúcula que lleva todos los días no es "un aumento del 17,5%". Sin volumen de ese
// producto no se puede ponderar, y ahí cae al promedio simple —que es peor, pero es lo
// único que hay, y el mail dice cuál de los dos está mostrando.
export function pctPonderado(productos: ProductoDelAumento[], vol: VolumenPorProducto): { pct: number; ponderado: boolean } {
  let base = 0, nuevo = 0;
  for (const p of productos) {
    const q = vol.get(p.producto) || 0;
    if (q <= 0) continue;
    base += q * p.anterior;
    nuevo += q * p.nuevo;
  }
  if (base > 0) return { pct: Math.round(((nuevo - base) / base) * 1000) / 10, ponderado: true };
  const conPct = productos.filter((p) => p.anterior > 0);
  if (!conPct.length) return { pct: 0, ponderado: false };
  return { pct: Math.round((conPct.reduce((a, p) => a + p.variacionPct, 0) / conPct.length) * 10) / 10, ponderado: false };
}

// Cuánta plata por mes agregó el aumento, al volumen de hoy. Estimación.
export function impactoMensual(productos: ProductoDelAumento[], vol: VolumenPorProducto): number {
  let total = 0;
  for (const p of productos) total += (vol.get(p.producto) || 0) * p.diferencia;
  return Math.round(total);
}

// Arma el reporte. Función pura: recibe todo ya leído y resuelto.
export function armarReporte(args: {
  hoy: string;
  // Volumen por cliente en la ventana, ya calculado donde se calcula para todo lo demás.
  volumen: { id_control: string; nombre: string; monto: number; unidades: number }[];
  // Cuánto compró cada cliente de cada producto, para ponderar.
  volumenPorProducto: Map<string, VolumenPorProducto>;
  historial: CambioPrecio[];
  preciosHoy: Map<string, { producto: string; precio: number }[]>;
}): FilaReportePrecios[] {
  const { hoy, volumen, volumenPorProducto, historial, preciosHoy } = args;

  const filas = volumen.map((v) => {
    const vol = volumenPorProducto.get(v.id_control) || new Map<string, number>();
    const tanda = ultimaTandaDeSuba(historial, v.id_control);
    const { pct } = tanda ? pctPonderado(tanda.productos, vol) : { pct: 0 };
    return {
      id_control: v.id_control,
      nombre: v.nombre,
      monto: Math.round(v.monto),
      unidades: Math.round(v.unidades),
      ultimaSuba: tanda ? {
        fecha: tanda.fecha,
        diasDesde: diasEntre(tanda.fecha, hoy),
        pctPromedio: pct,
        impactoMensual: impactoMensual(tanda.productos, vol),
        productos: tanda.productos,
      } : null,
      preciosHoy: preciosHoy.get(v.id_control) || [],
    };
  });

  // De mayor a menor volumen: la lista tiene que empezar por donde más pesa cada punto.
  // Entre dos sin volumen, el que hace más que no recibe un aumento primero, que es el que
  // más urge mirar.
  return filas.sort((a, b) =>
    (b.monto - a.monto)
    || ((b.ultimaSuba?.diasDesde ?? 99999) - (a.ultimaSuba?.diasDesde ?? 99999)));
}

// Los que hace mucho que no reciben un aumento, que es lo que se mira primero. El corte va
// como parámetro: lo que es "mucho" depende de la inflación del momento, no de una
// constante escrita acá.
export function atrasados(filas: FilaReportePrecios[], dias: number): FilaReportePrecios[] {
  return filas.filter((f) => f.monto > 0 && (!f.ultimaSuba || f.ultimaSuba.diasDesde >= dias));
}
