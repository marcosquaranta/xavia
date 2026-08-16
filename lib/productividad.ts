import type { Lote } from './types';

export interface PuntoProductividadMes {
  mes: string;   // YYYY-MM
  label: string; // "Ago 26"
  paquetes: number;
  horas: number;
  diasConDatos: number; // cuántos días del rango tienen horas cacheadas — 0 = sin datos todavía
  productividad: number | null;
}

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface FilaProductividadDiaria { fecha: string; horas_hombre: number | string }

// Días (YYYY-MM-DD) del rango [desde, hasta] para los que la caché diaria realmente tiene
// un valor de horas cargado. Clave para que "acumulado del mes" sea un acumulado HONESTO:
// si se sumara toda la cosecha del mes (paquetes/plantas) contra solo las horas de los
// pocos días que la caché ya cubre (recién arrancando, o un día que el cron no llegó a
// correr), el ratio queda artificialmente disparado — comparando "todo lo cosechado en 20
// días" contra "las horas de 1 solo día". Restringiendo también la cosecha a estos mismos
// días, el número es chico pero CORRECTO desde el primer día de caché, y crece solo hasta
// ser el mes completo a medida que se van sumando días (nunca "el último día" a secas).
export function diasCubiertosPorCache(cache: FilaProductividadDiaria[], desde: string, hasta: string): Set<string> {
  const set = new Set<string>();
  for (const fila of cache) {
    const f = String(fila.fecha || '').slice(0, 10);
    if (f && f >= desde && f <= hasta) set.add(f);
  }
  return set;
}

// Suma las horas-hombre cacheadas (ProductividadDiaria) en un rango de fechas [desde,
// hasta] (YYYY-MM-DD, ambos inclusive) — reemplaza a horasHombreEnRango(registros) de
// lib/personal.ts para todo lo que necesite un RANGO (semana, mes, varios meses), que
// antes implicaba pedirle ese rango a CrossChex en vivo.
export function horasHombreDesdeCache(cache: FilaProductividadDiaria[], desde: string, hasta: string): number {
  let total = 0;
  for (const fila of cache) {
    const f = String(fila.fecha || '').slice(0, 10);
    if (!f || f < desde || f > hasta) continue;
    total += Number(fila.horas_hombre) || 0;
  }
  return Math.round(total * 100) / 100;
}

// Cosecha (unidad mixta — paquetes de rúcula + plantas de lechuga sin reconvertir, mismo
// criterio que cosechadoEsteMes de lib/estadisticas.ts) de un lote, restringida a los días
// que la caché de horas ya cubre — ver diasCubiertosPorCache. Uso interno, compartido por
// productividadDeMes.
function cosechaEnDiasConDatos(lotes: Lote[], diasCache: Set<string>): number {
  let total = 0;
  for (const l of lotes) {
    if (l.estado !== 'cosechado') continue;
    const f = String(l.fecha_cosecha || l.fecha_ult_movimiento || '').split(/[T ]/)[0];
    if (!f || !diasCache.has(f)) continue;
    total += Number(l.unidades_cosechadas) || 0;
  }
  return total;
}

// Productividad ACUMULADA de un mes (paquetes cosechados ÷ horas-hombre reales), siempre
// sobre el mes completo (o lo que va del mes en curso) — nunca un solo día suelto. `cache`
// es la caché diaria completa (ProductividadDiaria, ver lib/types.ts); tanto la cosecha
// como las horas se restringen a los mismos días con dato real, así el número es correcto
// desde el primer día que hay caché (no se dispara por comparar todo el mes contra 1 sola
// jornada) y termina siendo el mes entero una vez que la caché lo cubre completo.
export function productividadDeMes(lotes: Lote[], cache: FilaProductividadDiaria[], anio: number, mes: number, diaHasta?: number): PuntoProductividadMes {
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = diaHasta ? Math.min(diaHasta, ultimoDia) : ultimoDia;
  const pad = (n: number) => String(n).padStart(2, '0');
  const desdeStr = `${anio}-${pad(mes)}-01`;
  const hastaStr = `${anio}-${pad(mes)}-${pad(hasta)}`;

  const diasCache = diasCubiertosPorCache(cache, desdeStr, hastaStr);
  const paquetes = cosechaEnDiasConDatos(lotes, diasCache);
  const horas = horasHombreDesdeCache(cache, desdeStr, hastaStr);
  return {
    mes: `${anio}-${pad(mes)}`, label: `${MESES_CORTO[mes - 1]} ${String(anio).slice(2)}`,
    paquetes, horas, diasConDatos: diasCache.size,
    productividad: horas > 0 ? Math.round((paquetes / horas) * 100) / 100 : null,
  };
}

export interface PuntoProductividadPlantasMes {
  mes: string; label: string;
  plantas: number; horas: number; diasConDatos: number; productividad: number | null; // plantas cosechadas / hora-persona
}

// Variante en PLANTAS (no paquetes) del indicador de arriba — es el KPI operativo que
// sigue Marcelo ("plantas cosechadas al mes por hora-persona totales"), pensado para
// comparar cultivos entre sí sin que el paso de empaque de rúcula (paquetes) lo distorsione.
// Rúcula cosechada en paquetes se reconvierte a plantas con plantas_por_unidad_real
// (fallback 3, mismo factor que el resto de la app); lechuga ya está en plantas. Mismo
// criterio de "solo días con dato real" que productividadDeMes — ver diasCubiertosPorCache.
// Pendiente de definir con Marcelo (no resuelto en la conversación): si esto cuenta solo
// el corte o corte + armado/empaque, y si conviene separar rúcula de lechuga — por ahora
// es cosecha total (todo lo que pasa por Movimientos tipo "cosecha"), sin desglosar.
export function productividadPlantasDeMes(lotes: Lote[], cache: FilaProductividadDiaria[], anio: number, mes: number, diaHasta?: number): PuntoProductividadPlantasMes {
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = diaHasta ? Math.min(diaHasta, ultimoDia) : ultimoDia;
  const pad = (n: number) => String(n).padStart(2, '0');
  const desdeStr = `${anio}-${pad(mes)}-01`;
  const hastaStr = `${anio}-${pad(mes)}-${pad(hasta)}`;

  const diasCache = diasCubiertosPorCache(cache, desdeStr, hastaStr);
  let plantas = 0;
  for (const l of lotes) {
    if (l.estado !== 'cosechado') continue;
    const f = String(l.fecha_cosecha || l.fecha_ult_movimiento || '').split(/[T ]/)[0];
    if (!f || !diasCache.has(f)) continue;
    const v = String(l.variedad || '').toLowerCase();
    const esRucula = v.includes('rucula') || v.includes('rúcula');
    plantas += esRucula
      ? (Number(l.unidades_cosechadas) || 0) * (Number(l.plantas_por_unidad_real) || 3)
      : (Number(l.unidades_cosechadas) || 0);
  }
  const horas = horasHombreDesdeCache(cache, desdeStr, hastaStr);
  return {
    mes: `${anio}-${pad(mes)}`, label: `${MESES_CORTO[mes - 1]} ${String(anio).slice(2)}`,
    plantas, horas, diasConDatos: diasCache.size,
    productividad: horas > 0 ? Math.round((plantas / horas) * 100) / 100 : null,
  };
}
