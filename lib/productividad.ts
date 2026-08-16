import type { Lote } from './types';

export interface PuntoProductividadMes {
  mes: string;   // YYYY-MM
  label: string; // "Ago 26"
  paquetes: number;
  horas: number;
  productividad: number | null;
}

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Productividad de UN mes puntual = paquetes cosechados ÷ horas-hombre reales. `horas` ya
// viene calculado desde afuera (suma de la caché diaria en ProductividadDiaria — ver
// horasHombreDesdeCache) en vez de fichajes crudos de CrossChex: CrossChex limita a 1
// pedido cada 15 segundos, así que ya no se le pide en vivo acá (ver comentario en
// lib/types.ts::ProductividadDiaria y app/api/cron/productividad-diaria).
export function productividadDeMes(lotes: Lote[], horas: number, anio: number, mes: number, diaHasta?: number): PuntoProductividadMes {
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = diaHasta ? Math.min(diaHasta, ultimoDia) : ultimoDia;
  const pad = (n: number) => String(n).padStart(2, '0');
  const desdeStr = `${anio}-${pad(mes)}-01`;
  const hastaStr = `${anio}-${pad(mes)}-${pad(hasta)}`;

  let paquetes = 0;
  for (const l of lotes) {
    if (l.estado !== 'cosechado') continue;
    const f = String(l.fecha_cosecha || l.fecha_ult_movimiento || '').split(/[T ]/)[0];
    if (!f || f < desdeStr || f > hastaStr) continue;
    paquetes += Number(l.unidades_cosechadas) || 0;
  }
  return {
    mes: `${anio}-${pad(mes)}`, label: `${MESES_CORTO[mes - 1]} ${String(anio).slice(2)}`,
    paquetes, horas, productividad: horas > 0 ? Math.round((paquetes / horas) * 100) / 100 : null,
  };
}

export interface PuntoProductividadPlantasMes {
  mes: string; label: string;
  plantas: number; horas: number; productividad: number | null; // plantas cosechadas / hora-persona
}

// Variante en PLANTAS (no paquetes) del indicador de arriba — es el KPI operativo que
// sigue Marcelo ("plantas cosechadas al mes por hora-persona totales"), pensado para
// comparar cultivos entre sí sin que el paso de empaque de rúcula (paquetes) lo distorsione.
// Rúcula cosechada en paquetes se reconvierte a plantas con plantas_por_unidad_real
// (fallback 3, mismo factor que el resto de la app); lechuga ya está en plantas.
// Pendiente de definir con Marcelo (no resuelto en la conversación): si esto cuenta solo
// el corte o corte + armado/empaque, y si conviene separar rúcula de lechuga — por ahora
// es cosecha total (todo lo que pasa por Movimientos tipo "cosecha"), sin desglosar.
export function productividadPlantasDeMes(lotes: Lote[], horas: number, anio: number, mes: number, diaHasta?: number): PuntoProductividadPlantasMes {
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = diaHasta ? Math.min(diaHasta, ultimoDia) : ultimoDia;
  const pad = (n: number) => String(n).padStart(2, '0');
  const desdeStr = `${anio}-${pad(mes)}-01`;
  const hastaStr = `${anio}-${pad(mes)}-${pad(hasta)}`;

  let plantas = 0;
  for (const l of lotes) {
    if (l.estado !== 'cosechado') continue;
    const f = String(l.fecha_cosecha || l.fecha_ult_movimiento || '').split(/[T ]/)[0];
    if (!f || f < desdeStr || f > hastaStr) continue;
    const v = String(l.variedad || '').toLowerCase();
    const esRucula = v.includes('rucula') || v.includes('rúcula');
    plantas += esRucula
      ? (Number(l.unidades_cosechadas) || 0) * (Number(l.plantas_por_unidad_real) || 3)
      : (Number(l.unidades_cosechadas) || 0);
  }
  return {
    mes: `${anio}-${pad(mes)}`, label: `${MESES_CORTO[mes - 1]} ${String(anio).slice(2)}`,
    plantas, horas, productividad: horas > 0 ? Math.round((plantas / horas) * 100) / 100 : null,
  };
}

// Suma las horas-hombre cacheadas (ProductividadDiaria) en un rango de fechas [desde,
// hasta] (YYYY-MM-DD, ambos inclusive) — reemplaza a horasHombreEnRango(registros) de
// lib/personal.ts para todo lo que necesite un RANGO (semana, mes, varios meses), que
// antes implicaba pedirle ese rango a CrossChex en vivo.
export function horasHombreDesdeCache(cache: { fecha: string; horas_hombre: number | string }[], desde: string, hasta: string): number {
  let total = 0;
  for (const fila of cache) {
    const f = String(fila.fecha || '').slice(0, 10);
    if (!f || f < desde || f > hasta) continue;
    total += Number(fila.horas_hombre) || 0;
  }
  return Math.round(total * 100) / 100;
}
