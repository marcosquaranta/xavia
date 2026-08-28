import type { Lote, Movimiento, StockCamara, Ubicacion, VentaDia } from './types';
import { descartePorFaseMes } from './descarte';
import { diferenciaAjustesMes, type CultivoCamara } from './camara';
import { plantasPerdidasPorSubocupacion } from './kpisOperativos';
import { cicloMesPromedio } from './estadisticas';
import type { OcupacionHistorialRow } from './ocupacion';

// Reconversión paquete → planta para poder sumar "faltante de stock" (que se mide en
// paquetes de producto terminado) junto con descarte y subocupación (que se miden en
// plantas) en una sola cuenta de pérdidas — mismo criterio ya usado en toda la app
// (productividadPlantasDeMes, eficienciaSiembraCosechaPorMes): rúcula sale de la planta
// armada en paquetes de ~3 plantas, lechuga es 1 planta = 1 paquete directo.
const PLANTAS_POR_PAQ_RUCULA = 3;
const PLANTAS_POR_PAQ_LECHUGA = 1;
// Albahaca: 1 posición = 1 paquete (POSPAQ_ALBAHACA), así que va 1:1 igual que lechuga.
function factorPlantaPorPaq(cultivo: CultivoCamara): number {
  return cultivo === 'rucula' ? PLANTAS_POR_PAQ_RUCULA : PLANTAS_POR_PAQ_LECHUGA;
}

export interface PerdidasMes {
  mes: string; label: string;
  descarte: number;       // plantas — SOLO F2→Cosecha (a pedido explícito, ver nota abajo)
  faltanteStock: number;  // plantas — solo lo que FALTÓ (contado por debajo de lo esperado), reconvertido
  subocupacion: number;   // plantas — tubos F2 vacíos, ver plantasPerdidasPorSubocupacion
  total: number;
}

// Junta las 3 pérdidas que hoy se ven por separado (Descarte por fase, Faltante de stock
// en cámara, Ocupación) en una sola cuenta MES A MES, todas reconvertidas a la misma
// unidad (plantas) — para poder compararlas entre sí y ver cuál pesa más en cada mes, en
// vez de tres números sueltos en tres pantallas distintas que nunca se suman.
//
// "Faltante de stock" solo cuenta la parte NEGATIVA (lo que faltó) — un sobrante no es una
// pérdida física de producto, es la señal contraria (se contó de más de lo esperado).
//
// "Descarte" acá es SOLO F2→Cosecha (a pedido explícito) — Plantín→F1, F1→F2 y Cámara NO
// entran en esta cuenta puntual (siguen viéndose desglosados en "Descarte por fase").
export function perdidasPorMes(
  lotes: Lote[], movimientos: Movimiento[], registrosCamara: StockCamara[], ventas: VentaDia[],
  ubicaciones: Ubicacion[], ocupacionHistorial: OcupacionHistorialRow[], nMeses = 12
): PerdidasMes[] {
  const mesesDescarte = descartePorFaseMes(lotes, movimientos, registrosCamara, nMeses);
  const mapaDescarte = new Map(mesesDescarte.map((m) => [m.mes, m]));
  const cultivos: CultivoCamara[] = ['rucula', 'lechuga_crespa', 'lechuga_roble', 'albahaca'];
  const hoy = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  const out: PerdidasMes[] = [];
  for (let i = nMeses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const mesKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const mesData = mapaDescarte.get(mesKey);

    // Descarte: SOLO F2→Cosecha (a pedido explícito) — Plantín→F1, F1→F2 y Cámara quedan
    // afuera de esta cuenta puntual (siguen desglosados en la sección "Descarte por fase"
    // de arriba); acá interesa específicamente lo que se pierde en la última etapa
    // productiva, ya está en plantas, sin reconversión.
    let descarte = 0;
    if (mesData) {
      for (const c of cultivos) {
        descarte += mesData[c].f2Cosecha;
      }
    }

    // Faltante de stock del mes, solo la parte que faltó, reconvertida a plantas
    let faltanteStock = 0;
    for (const c of cultivos) {
      const dif = diferenciaAjustesMes(c, registrosCamara, lotes, ventas, d);
      faltanteStock += Math.max(0, -dif.acumulado) * factorPlantaPorPaq(c);
    }

    // Subocupación del mes, con el ciclo F2 ACTUAL de ese mes como referencia (si el mes
    // no tuvo cosechas reales de las que sacar un ciclo, cae a un valor de referencia
    // razonable en vez de dejar el cálculo en cero solo por falta de dato)
    const cicloDelMes = cicloMesPromedio(lotes, movimientos, d);
    const finMes = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const desdeStr = `${mesKey}-01`;
    const hastaStr = `${mesKey}-${pad(finMes.getDate())}`;
    const subocupacion = plantasPerdidasPorSubocupacion(
      ocupacionHistorial, ubicaciones, desdeStr, hastaStr,
      cicloDelMes.rucula || 35, cicloDelMes.lechuga || 40,
      movimientos, // margen de 24hs post-cosecha
    ).total;

    out.push({
      mes: mesKey, label: mesData?.label || mesKey,
      descarte: Math.round(descarte), faltanteStock: Math.round(faltanteStock), subocupacion: Math.round(subocupacion),
      total: Math.round(descarte + faltanteStock + subocupacion),
    });
  }
  return out;
}
