import type { Lote, VentaDia, StockCamara } from './types';

export type CultivoCamara = 'rucula' | 'lechuga_crespa' | 'lechuga_roble';

function parseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).split(/[\sT]/)[0];
  if (!str) return null;
  const d = new Date(str + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function esRucula(variedad: string) {
  const v = String(variedad || '').toLowerCase();
  return v.includes('rucula') || v.includes('rúcula');
}
function esCrespa(variedad: string) {
  return String(variedad || '').toLowerCase().includes('crespa');
}
// "Roble" es el catch-all de lechuga (hoja de roble + cualquier otra variedad de
// lechuga que no sea explícitamente crespa) — así nunca se pierde stock de un lote con
// una variedad rara sin clasificar, igual criterio que ya se usa en lib/usoTeorico.ts.
function matchCultivo(cultivo: CultivoCamara, variedad: string): boolean {
  if (cultivo === 'rucula') return esRucula(variedad);
  if (esRucula(variedad)) return false;
  return cultivo === 'lechuga_crespa' ? esCrespa(variedad) : !esCrespa(variedad);
}

// Paquetes cosechados de `cultivo` con fecha en (desde, hasta] — mismo criterio que
// calcularCamara, pero acotado a un rango (no siempre "hasta hoy").
function cosechadoEntre(cultivo: CultivoCamara, lotes: Lote[], desde: Date, hasta: Date): number {
  return lotes
    .filter(l => {
      if (l.estado !== 'cosechado') return false;
      if (!matchCultivo(cultivo, l.variedad)) return false;
      const f = parseDate(l.fecha_cosecha || l.fecha_ult_movimiento);
      return f && f > desde && f <= hasta;
    })
    .reduce((a, l) => a + (Number(l.unidades_cosechadas) || 0), 0);
}

// Paquetes vendidos (exportados a Xubio) de `cultivo` con fecha en (desde, hasta].
// El export marca `exportado` con el id de exportación (ej. "EXP-20260619-1430"),
// NO con el literal 'SI'. Por eso se descuenta cualquier venta con exportado no vacío.
// lechuga_crespa/hoja_roble ya son campos separados en Ventas — no hace falta
// clasificar por texto de variedad como con las cosechas.
function vendidoEntre(cultivo: CultivoCamara, ventas: VentaDia[], desde: Date, hasta: Date): number {
  return ventas
    .filter(v => {
      if (!v.exportado || String(v.exportado).trim() === '') return false;
      const f = parseDate(v.fecha);
      return f && f > desde && f <= hasta;
    })
    .reduce((acc, v) => {
      if (cultivo === 'rucula') return acc + (Number(v.rucula) || 0) + (Number(v.bandeja_rucula) || 0);
      if (cultivo === 'lechuga_crespa') return acc + (Number(v.lechuga_crespa) || 0);
      return acc + (Number(v.hoja_roble) || 0);
    }, 0);
}

export interface ResultadoCamara {
  cultivo: CultivoCamara;
  stockActual: number;
  diasPromedio: number;
  base: StockCamara | null;
}

export function calcularCamara(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[]
): ResultadoCamara {
  const hoy = new Date();

  // Último registro base para este cultivo
  const base = [...registros]
    .filter(r => r.cultivo === cultivo)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .find(() => true) ?? null;

  if (!base) return { cultivo, stockActual: 0, diasPromedio: 0, base: null };

  const fechaBase = parseDate(base.fecha);
  if (!fechaBase) return { cultivo, stockActual: 0, diasPromedio: 0, base };

  const cantidadBase = Number(base.cantidad_paq) || 0;

  // Cosechas desde fechaBase (exclusive: solo posteriores a la base)
  const cosechas = lotes
    .filter(l => {
      if (l.estado !== 'cosechado') return false;
      if (!matchCultivo(cultivo, l.variedad)) return false;
      const f = parseDate(l.fecha_cosecha || l.fecha_ult_movimiento);
      return f && f > fechaBase;
    })
    .map(l => ({ fecha: parseDate(l.fecha_cosecha || l.fecha_ult_movimiento)!, cantidad: Number(l.unidades_cosechadas) || 0 }))
    .filter(e => e.cantidad > 0);

  const totalVendido = vendidoEntre(cultivo, ventas, fechaBase, hoy);
  const totalCosechado = cosechas.reduce((a, c) => a + c.cantidad, 0);
  const stockActual = Math.max(0, cantidadBase + totalCosechado - totalVendido);

  // FIFO para días promedio
  // Cola: base primero, luego cosechas ordenadas por fecha ASC
  const cola: { fecha: Date; cantidad: number }[] = [
    { fecha: fechaBase, cantidad: cantidadBase },
    ...cosechas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
  ];

  // Descontar ventas empezando por lo más antiguo
  let porDescontar = totalVendido;
  for (const entrada of cola) {
    if (porDescontar <= 0) break;
    const desc = Math.min(entrada.cantidad, porDescontar);
    entrada.cantidad -= desc;
    porDescontar -= desc;
  }

  // Calcular días promedio ponderado de lo que queda
  const restantes = cola.filter(e => e.cantidad > 0);
  const totalRestante = restantes.reduce((a, e) => a + e.cantidad, 0);
  if (totalRestante === 0) return { cultivo, stockActual, diasPromedio: 0, base };

  const diasProm = restantes.reduce((acc, e) => {
    const dias = Math.round((hoy.getTime() - e.fecha.getTime()) / 86400000);
    return acc + dias * e.cantidad;
  }, 0) / totalRestante;

  return { cultivo, stockActual, diasPromedio: Math.round(diasProm), base };
}

// Diferencia entre una cantidad nueva (contada a mano) y lo que el sistema esperaba
// tener en cámara a esa fecha (stock teórico según la última base + movimientos desde
// entonces). Sirve tanto para avisar al cargar un ajuste como para el acumulado mensual.
export function diferenciaAjuste(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[],
  cantidadNueva: number,
  fecha: Date = new Date()
): number {
  const anteriores = [...registros]
    .filter(r => r.cultivo === cultivo)
    .map(r => ({ ...r, _f: parseDate(r.fecha) }))
    .filter((r): r is StockCamara & { _f: Date } => !!r._f && r._f <= fecha)
    .sort((a, b) => a._f.getTime() - b._f.getTime());
  const prev = anteriores[anteriores.length - 1];
  if (!prev) return 0; // sin base previa, no hay con qué comparar

  const cosechado = cosechadoEntre(cultivo, lotes, prev._f, fecha);
  const vendido = vendidoEntre(cultivo, ventas, prev._f, fecha);
  const teorico = Math.max(0, (Number(prev.cantidad_paq) || 0) + cosechado - vendido);
  return Math.round(cantidadNueva - teorico);
}

export interface DiferenciaAjustesMes { acumulado: number; cantidadAjustes: number }

// Suma las diferencias reveladas por cada ajuste cargado en el mes de `fechaRef`
// (por defecto el mes en curso) — "cuánto se corrigió" acumulado ese mes.
export function diferenciaAjustesMes(
  cultivo: CultivoCamara,
  registros: StockCamara[],
  lotes: Lote[],
  ventas: VentaDia[],
  fechaRef: Date = new Date()
): DiferenciaAjustesMes {
  const ordenados = [...registros]
    .filter(r => r.cultivo === cultivo)
    .map(r => ({ ...r, _f: parseDate(r.fecha) }))
    .filter((r): r is StockCamara & { _f: Date } => !!r._f)
    .sort((a, b) => a._f.getTime() - b._f.getTime());

  let acumulado = 0, cantidadAjustes = 0;
  for (let i = 1; i < ordenados.length; i++) {
    const curr = ordenados[i];
    if (curr.tipo !== 'ajuste') continue;
    if (curr._f.getFullYear() !== fechaRef.getFullYear() || curr._f.getMonth() !== fechaRef.getMonth()) continue;
    const prev = ordenados[i - 1];
    const cosechado = cosechadoEntre(cultivo, lotes, prev._f, curr._f);
    const vendido = vendidoEntre(cultivo, ventas, prev._f, curr._f);
    const teorico = Math.max(0, (Number(prev.cantidad_paq) || 0) + cosechado - vendido);
    acumulado += Number(curr.cantidad_paq) - teorico;
    cantidadAjustes++;
  }
  return { acumulado: Math.round(acumulado), cantidadAjustes };
}
