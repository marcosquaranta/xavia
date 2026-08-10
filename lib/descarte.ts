import type { Lote, Movimiento } from './types';

export type CultivoDescarte = 'rucula' | 'lechuga_crespa' | 'lechuga_roble';

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Mismo criterio de clasificación que lib/camara.ts / lib/usoTeorico.ts: "roble" es el
// catch-all de lechuga (hoja de roble + cualquier variedad de lechuga sin clasificar
// explícitamente como crespa) — así nunca se pierde descarte de una variedad rara.
// Albahaca (u otro cultivo fuera de estos 3) queda afuera, no tiene columna acá.
function clasificar(variedad: string): CultivoDescarte | null {
  const v = String(variedad || '').toLowerCase();
  if (v.includes('rucula') || v.includes('rúcula')) return 'rucula';
  if (v.includes('albahaca')) return null;
  return v.includes('crespa') ? 'lechuga_crespa' : 'lechuga_roble';
}

export interface DescarteTresFases { plantinF1: number; f1F2: number; f2Cosecha: number }
function cero(): DescarteTresFases { return { plantinF1: 0, f1F2: 0, f2Cosecha: 0 }; }

export interface DescarteFasesMes {
  mes: string;   // YYYY-MM
  label: string; // "Ago 26"
  rucula: DescarteTresFases;
  lechuga_crespa: DescarteTresFases;
  lechuga_roble: DescarteTresFases;
}

// Plantines descartados por mes, cultivo y etapa de transición — Plantín→F1 y F1→F2 salen
// de los Movimientos de tipo "trasplante" (fase_origen/fase_destino), F2→Cosecha del
// Movimiento de tipo "cosecha" del lote. descarte_calculado ya está en plantas reales en
// los 3 casos (ver fix de unidades en app/api/lotes/trasplante/route.ts), así que se
// pueden sumar directo sin reconvertir.
export function descartePorFaseMes(lotes: Lote[], movimientos: Movimiento[], nMeses = 12): DescarteFasesMes[] {
  const hoy = new Date();
  const meses: DescarteFasesMes[] = [];
  for (let i = nMeses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    meses.push({ mes, label: `${MESES_CORTO[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, rucula: cero(), lechuga_crespa: cero(), lechuga_roble: cero() });
  }
  const idxPorMes = new Map(meses.map((m, i) => [m.mes, i]));
  const lotesMap = new Map(lotes.map((l) => [l.id_lote, l]));

  for (const m of movimientos) {
    const lote = lotesMap.get(String(m.id_lote || '')); if (!lote) continue;
    const cultivo = clasificar(lote.variedad); if (!cultivo) continue;
    const mk = String(m.fecha || '').slice(0, 7);
    const idx = idxPorMes.get(mk); if (idx === undefined) continue;
    const descarte = Number(m.descarte_calculado) || 0;
    if (descarte <= 0) continue;
    if (m.tipo === 'trasplante') {
      if (m.fase_origen === 'plantin' && m.fase_destino === 'fase_1') meses[idx][cultivo].plantinF1 += descarte;
      else if (m.fase_origen === 'fase_1' && m.fase_destino === 'fase_2') meses[idx][cultivo].f1F2 += descarte;
    } else if (m.tipo === 'cosecha') {
      meses[idx][cultivo].f2Cosecha += descarte;
    }
  }
  return meses;
}

export interface ResumenDescarteCultivo {
  cultivo: CultivoDescarte;
  plantinF1: number; f1F2: number; f2Cosecha: number; total: number;
  pctPlantinF1: number; pctF1F2: number; pctF2Cosecha: number;
}

// Resumen en % de dónde se concentra el descarte de cada cultivo, sumado sobre todos los
// meses del gráfico — el cuadro que acompaña al gráfico de columnas apiladas.
export function resumenDescartePorCultivo(meses: DescarteFasesMes[]): ResumenDescarteCultivo[] {
  const cultivos: CultivoDescarte[] = ['rucula', 'lechuga_crespa', 'lechuga_roble'];
  return cultivos.map((cultivo) => {
    const plantinF1 = meses.reduce((a, m) => a + m[cultivo].plantinF1, 0);
    const f1F2 = meses.reduce((a, m) => a + m[cultivo].f1F2, 0);
    const f2Cosecha = meses.reduce((a, m) => a + m[cultivo].f2Cosecha, 0);
    const total = plantinF1 + f1F2 + f2Cosecha;
    return {
      cultivo, plantinF1, f1F2, f2Cosecha, total,
      pctPlantinF1: total > 0 ? Math.round((plantinF1 / total) * 1000) / 10 : 0,
      pctF1F2: total > 0 ? Math.round((f1F2 / total) * 1000) / 10 : 0,
      pctF2Cosecha: total > 0 ? Math.round((f2Cosecha / total) * 1000) / 10 : 0,
    };
  });
}
