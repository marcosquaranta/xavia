import type { Lote, VentaDia, StockCamara } from './types';

function parseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).split(/[\sT]/)[0];
  if (!str) return null;
  const d = new Date(str + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function isRucula(variedad: string) {
  const v = String(variedad || '').toLowerCase();
  return v.includes('rucula') || v.includes('rúcula');
}

export interface ResultadoCamara {
  cultivo: 'rucula' | 'lechuga';
  stockActual: number;
  diasPromedio: number;
  base: StockCamara | null;
}

export function calcularCamara(
  cultivo: 'rucula' | 'lechuga',
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
      if (cultivo === 'rucula' ? !isRucula(l.variedad) : isRucula(l.variedad)) return false;
      const f = parseDate(l.fecha_cosecha || l.fecha_ult_movimiento);
      return f && f > fechaBase;
    })
    .map(l => ({ fecha: parseDate(l.fecha_cosecha || l.fecha_ult_movimiento)!, cantidad: Number(l.unidades_cosechadas) || 0 }))
    .filter(e => e.cantidad > 0);

  // Ventas exportadas desde fechaBase (= producto que ya salió de cámara).
  // El export marca `exportado` con el id de exportación (ej. "EXP-20260619-1430"),
  // NO con el literal 'SI'. Por eso descontamos cualquier venta con exportado no vacío.
  const totalVendido = ventas
    .filter(v => {
      if (!v.exportado || String(v.exportado).trim() === '') return false;
      const f = parseDate(v.fecha);
      return f && f > fechaBase;
    })
    .reduce((acc, v) => {
      if (cultivo === 'rucula') return acc + (Number(v.rucula) || 0) + (Number(v.bandeja_rucula) || 0);
      return acc + (Number(v.lechuga_crespa) || 0) + (Number(v.hoja_roble) || 0);
    }, 0);

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
