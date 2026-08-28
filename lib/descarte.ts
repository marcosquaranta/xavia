import type { Lote, Movimiento, StockCamara } from './types';

export type CultivoDescarte = 'rucula' | 'lechuga_crespa' | 'lechuga_roble' | 'albahaca';

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Mismo criterio de clasificación que lib/camara.ts / lib/usoTeorico.ts: "roble" es el
// catch-all de lechuga (hoja de roble + cualquier otra variedad de lechuga sin clasificar
// explícitamente como crespa) — así nunca se pierde descarte de una variedad rara.
/// Albahaca tiene su propia columna (se empezó a producir en la Mesada 3 junto con rúcula);
// cualquier otro cultivo fuera de estos 4 queda afuera.
export function clasificarCultivoDescarte(variedad: string): CultivoDescarte | null {
  const v = String(variedad || '').toLowerCase();
  if (v.includes('rucula') || v.includes('rúcula')) return 'rucula';
  if (v.includes('albahaca')) return 'albahaca';
  return v.includes('crespa') ? 'lechuga_crespa' : 'lechuga_roble';
}

// Además del descarte de cada fase se guarda la BASE que pasó por esa fase (lo que entró
// a la transición: descartado + lo que siguió vivo). Sin eso, un "1.200 plantas" no dice
// nada: puede ser malísimo o irrelevante según si pasaron 3.000 o 300.000 por ahí. El % se
// calcula sobre esa base, no sobre el total de descarte (que solo decía en qué fase se
// concentra, no qué tan grave es).
export interface DescarteFases {
  plantinF1: number; f1F2: number; f2Cosecha: number; camara: number;
  basePlantinF1: number; baseF1F2: number; baseF2Cosecha: number;
}
function cero(): DescarteFases { return { plantinF1: 0, f1F2: 0, f2Cosecha: 0, camara: 0, basePlantinF1: 0, baseF1F2: 0, baseF2Cosecha: 0 }; }

export interface DescarteFasesMes {
  mes: string;   // YYYY-MM
  label: string; // "Ago 26"
  rucula: DescarteFases;
  lechuga_crespa: DescarteFases;
  lechuga_roble: DescarteFases;
  albahaca: DescarteFases;
}

// Plantines/paquetes descartados por mes, cultivo y etapa — Plantín→F1 y F1→F2 salen de
// los Movimientos de tipo "trasplante" (fase_origen/fase_destino), F2→Cosecha del
// Movimiento de tipo "cosecha" del lote, y Cámara del descarte explícito cargado al
// registrar un ajuste de stock en cámara (StockCamara.descarte_paq — ver
// components/AjusteStockCard.tsx). descarte_calculado ya está en plantas reales en los 3
// primeros casos (ver fix de unidades en app/api/lotes/trasplante/route.ts), así que se
// suman directo. El de cámara está en PAQUETES (no plantas) — se suma en su propia
// columna, no se mezcla con las plantas de las otras 3 etapas.
export function descartePorFaseMes(lotes: Lote[], movimientos: Movimiento[], registrosCamara: StockCamara[], nMeses = 12): DescarteFasesMes[] {
  const hoy = new Date();
  const meses: DescarteFasesMes[] = [];
  for (let i = nMeses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    meses.push({ mes, label: `${MESES_CORTO[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, rucula: cero(), lechuga_crespa: cero(), lechuga_roble: cero(), albahaca: cero() });
  }
  const idxPorMes = new Map(meses.map((m, i) => [m.mes, i]));
  const lotesMap = new Map(lotes.map((l) => [l.id_lote, l]));

  for (const m of movimientos) {
    const lote = lotesMap.get(String(m.id_lote || '')); if (!lote) continue;
    const cultivo = clasificarCultivoDescarte(lote.variedad); if (!cultivo) continue;
    const mk = String(m.fecha || '').slice(0, 7);
    const idx = idxPorMes.get(mk); if (idx === undefined) continue;
    const descarte = Number(m.descarte_calculado) || 0;
    const plantas = Number(m.plantas_estimadas) || 0;
    if (m.tipo === 'trasplante') {
      // En un trasplante, plantas_estimadas son las que SIGUIERON (el descarte va aparte),
      // así que la base de la transición es la suma de las dos.
      const base = plantas + descarte;
      if (base <= 0) continue;
      if (m.fase_origen === 'plantin' && m.fase_destino === 'fase_1') {
        meses[idx][cultivo].plantinF1 += descarte; meses[idx][cultivo].basePlantinF1 += base;
      } else if (m.fase_origen === 'fase_1' && m.fase_destino === 'fase_2') {
        meses[idx][cultivo].f1F2 += descarte; meses[idx][cultivo].baseF1F2 += base;
      }
    } else if (m.tipo === 'cosecha') {
      // En la cosecha, plantas_estimadas YA incluye el descarte (ver app/api/lotes/cosecha:
      // plantasUsadas = unidades + descarte), así que es la base directamente.
      const base = plantas > 0 ? plantas : descarte;
      if (base <= 0) continue;
      meses[idx][cultivo].f2Cosecha += descarte; meses[idx][cultivo].baseF2Cosecha += base;
    }
  }

  for (const r of registrosCamara) {
    const descarte = Number(r.descarte_paq) || 0;
    if (descarte <= 0) continue;
    // El cultivo de StockCamara ya viene como 'rucula'|'lechuga_crespa'|'lechuga_roble'
    // directo (o 'lechuga', legado de antes del split — sin descarte_paq cargado, campo
    // nuevo, así que no hace falta reclasificar registros viejos).
    const cultivo = r.cultivo as CultivoDescarte;
    if (cultivo !== 'rucula' && cultivo !== 'lechuga_crespa' && cultivo !== 'lechuga_roble' && cultivo !== 'albahaca') continue;
    const mk = String(r.fecha || '').slice(0, 7);
    const idx = idxPorMes.get(mk); if (idx === undefined) continue;
    meses[idx][cultivo].camara += descarte;
  }

  return meses;
}

export interface ResumenDescarteCultivo {
  cultivo: CultivoDescarte;
  plantinF1: number; f1F2: number; f2Cosecha: number; camara: number; total: number;
  basePlantinF1: number; baseF1F2: number; baseF2Cosecha: number;
  // % de descarte SOBRE LO QUE PASÓ POR ESA FASE (no sobre el total de descarte) — null si
  // esa fase no tuvo movimientos en el período, para no mostrar un 0% engañoso.
  pctPlantinF1: number | null; pctF1F2: number | null; pctF2Cosecha: number | null;
}

// Resumen del descarte de cada cultivo, sumado sobre todos los meses del gráfico. El % de
// cada fase es sobre LO QUE PASÓ POR ESA FASE (descartado + lo que siguió vivo), que es lo
// que dice si el descarte es grave o no. El `total` en cambio sigue siendo una suma que
// mezcla plantas (las 3 etapas de producción) con paquetes (cámara): sirve de referencia
// de volumen, no es una cantidad físicamente exacta.
export function resumenDescartePorCultivo(meses: DescarteFasesMes[]): ResumenDescarteCultivo[] {
  const cultivos: CultivoDescarte[] = ['rucula', 'lechuga_crespa', 'lechuga_roble', 'albahaca'];
  return cultivos.map((cultivo) => {
    const plantinF1 = meses.reduce((a, m) => a + m[cultivo].plantinF1, 0);
    const f1F2 = meses.reduce((a, m) => a + m[cultivo].f1F2, 0);
    const f2Cosecha = meses.reduce((a, m) => a + m[cultivo].f2Cosecha, 0);
    const camara = meses.reduce((a, m) => a + m[cultivo].camara, 0);
    const basePlantinF1 = meses.reduce((a, m) => a + m[cultivo].basePlantinF1, 0);
    const baseF1F2 = meses.reduce((a, m) => a + m[cultivo].baseF1F2, 0);
    const baseF2Cosecha = meses.reduce((a, m) => a + m[cultivo].baseF2Cosecha, 0);
    const total = plantinF1 + f1F2 + f2Cosecha + camara;
    const pctDe = (desc: number, base: number) => base > 0 ? Math.round((desc / base) * 1000) / 10 : null;
    return {
      cultivo, plantinF1, f1F2, f2Cosecha, camara, total,
      basePlantinF1, baseF1F2, baseF2Cosecha,
      pctPlantinF1: pctDe(plantinF1, basePlantinF1),
      pctF1F2: pctDe(f1F2, baseF1F2),
      pctF2Cosecha: pctDe(f2Cosecha, baseF2Cosecha),
    };
  });
}
