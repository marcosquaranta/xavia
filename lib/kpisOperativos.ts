import type { Lote, Ubicacion } from './types';
import type { OcupacionHistorialRow } from './ocupacion';
import { clasificarCultivoDescarte, type CultivoDescarte } from './descarte';

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// ══════════════════════════════════════════════════════════════════════════════════════
// KPI 1 — Ocupación de posiciones, PROMEDIO MENSUAL (no foto puntual), abierto por
// cultivo. Objetivo acordado con Marcelo: 95%.
// ══════════════════════════════════════════════════════════════════════════════════════

export type CultivoOcupacion = 'rucula' | 'lechuga' | 'mixta';

export interface OcupacionMesCultivo {
  mes: string; label: string;
  rucula: { pct: number | null };
  lechuga: { pct: number | null };
  mixta: { pct: number | null };
  total: { pct: number | null };
}

// Mismo criterio de normalización de nombre de mesada que lib/ocupacion.ts (tubosPorMesada)
// — hay que matchear "mesada + nave" porque el nombre se repite entre naves.
function normMesada(s: string): string {
  return s.trim().toLowerCase().replace(/^nave\s*\d+\s*-\s*/, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normBaseMesada(s: string): string {
  return normMesada(s.replace(/\s*\([^F][^)]*\)\s*$/, '').replace(/\s*\(\d[^)]*\)\s*$/, ''));
}

// Promedio ponderado por tubos (no promedio simple de %, que pesaría igual una mesada
// chica que una grande) — el histórico diario (OcupacionHistorial, cargado por el cron)
// SÍ contempla los huecos entre cosecha y trasplante, a diferencia de una foto puntual de
// "ahora": si una mesada estuvo vacía 4 de 30 días, esos 4 días bajan el promedio del mes.
export function ocupacionMensualPorCultivo(historial: OcupacionHistorialRow[], ubicaciones: Ubicacion[], nMeses = 6): OcupacionMesCultivo[] {
  // Solo mesadas F2 — mismo alcance que el cron que carga el histórico (sector_fase !== 'fase_1')
  const mesadas = ubicaciones.filter((u) => u.tipo === 'mesada');
  const cultivoDeMesada = new Map<string, CultivoOcupacion>();
  for (const u of mesadas) {
    const va = String(u.variedad_asignada || '').toLowerCase();
    const cultivo: CultivoOcupacion = va === 'rucula' || va === 'rúcula' ? 'rucula' : va === 'mixta' ? 'mixta' : 'lechuga';
    cultivoDeMesada.set(`${normMesada(u.nombre)}||${u.nave}`, cultivo);
    cultivoDeMesada.set(`${normBaseMesada(u.nombre)}||${u.nave}`, cultivo);
  }
  function cultivoDe(mesadaNombre: string, nave: string | number): CultivoOcupacion | null {
    const key1 = `${normMesada(mesadaNombre)}||${nave}`, key2 = `${normBaseMesada(mesadaNombre)}||${nave}`;
    return cultivoDeMesada.get(key1) ?? cultivoDeMesada.get(key2) ?? null;
  }

  const hoy = new Date();
  const meses: OcupacionMesCultivo[] = [];
  for (let i = nMeses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    meses.push({ mes, label: `${MESES_CORTO[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, rucula: { pct: null }, lechuga: { pct: null }, mixta: { pct: null }, total: { pct: null } });
  }
  const idxPorMes = new Map(meses.map((m, i) => [m.mes, i]));

  // Acumuladores tubos ocupados/totales por (mes, cultivo) y (mes, total)
  const acc: Record<string, { ocu: number; tot: number }> = {};
  function sumar(key: string, ocu: number, tot: number) {
    if (!acc[key]) acc[key] = { ocu: 0, tot: 0 };
    acc[key].ocu += ocu; acc[key].tot += tot;
  }
  for (const r of historial) {
    const mk = String(r.fecha || '').slice(0, 7);
    const idx = idxPorMes.get(mk); if (idx === undefined) continue;
    const cultivo = cultivoDe(String(r.mesada || ''), r.nave);
    const ocu = Number(r.tubos_ocupados) || 0, tot = Number(r.tubos_totales) || 0;
    if (tot <= 0) continue;
    sumar(`${idx}||total`, ocu, tot);
    if (cultivo) sumar(`${idx}||${cultivo}`, ocu, tot);
  }
  for (let idx = 0; idx < meses.length; idx++) {
    const pct = (cultivo: string) => {
      const a = acc[`${idx}||${cultivo}`];
      return a && a.tot > 0 ? Math.round((a.ocu / a.tot) * 1000) / 10 : null;
    };
    meses[idx].rucula.pct = pct('rucula');
    meses[idx].lechuga.pct = pct('lechuga');
    meses[idx].mixta.pct = pct('mixta');
    meses[idx].total.pct = pct('total');
  }
  return meses;
}

// ══════════════════════════════════════════════════════════════════════════════════════
// KPI 2 — Eficiencia Siembra → Cosecha (versión final acordada: NO es "unidades vendidas
// / sembradas" — Marcelo pidió sacar la venta/cámara de la cuenta porque no depende de
// su gestión — es lo que efectivamente llega vivo a cosecha sobre lo que arrancó en el
// lote, sumado por mes de cosecha y cultivo. El desglose por fase (Plantín→F1, F1→F2,
// F2→Cosecha) que explica ESTE número ya está en la sección "Descarte por fase" de más
// abajo, con el mismo criterio de clasificación de cultivo.
// ══════════════════════════════════════════════════════════════════════════════════════

export interface EficienciaMesCultivo {
  mes: string; label: string;
  rucula: { viva: number; descarte: number; pct: number | null };
  lechuga_crespa: { viva: number; descarte: number; pct: number | null };
  lechuga_roble: { viva: number; descarte: number; pct: number | null };
}

export function eficienciaSiembraCosechaPorMes(lotes: Lote[], nMeses = 6): EficienciaMesCultivo[] {
  const hoy = new Date();
  const meses: EficienciaMesCultivo[] = [];
  for (let i = nMeses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    meses.push({
      mes, label: `${MESES_CORTO[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      rucula: { viva: 0, descarte: 0, pct: null }, lechuga_crespa: { viva: 0, descarte: 0, pct: null }, lechuga_roble: { viva: 0, descarte: 0, pct: null },
    });
  }
  const idxPorMes = new Map(meses.map((m, i) => [m.mes, i]));

  for (const l of lotes) {
    if (l.estado !== 'cosechado' || !l.fecha_cosecha) continue;
    const cultivo = clasificarCultivoDescarte(l.variedad); if (!cultivo) continue;
    const mk = String(l.fecha_cosecha).slice(0, 7);
    const idx = idxPorMes.get(mk); if (idx === undefined) continue;
    // Mismo criterio que la ficha del lote: rúcula cosechada en paquetes se reconvierte a
    // plantas reales con plantas_por_unidad_real (fallback 3, el factor histórico de la
    // app); lechuga ya está en plantas directamente.
    const esRucula = cultivo === 'rucula';
    const viva = esRucula
      ? (Number(l.unidades_cosechadas) || 0) * (Number(l.plantas_por_unidad_real) || 3)
      : (Number(l.unidades_cosechadas) || 0);
    const descarte = Number(l.descarte_reportado) || 0;
    meses[idx][cultivo].viva += viva;
    meses[idx][cultivo].descarte += descarte;
  }
  for (const m of meses) {
    (['rucula', 'lechuga_crespa', 'lechuga_roble'] as const).forEach((c) => {
      const base = m[c].viva + m[c].descarte;
      m[c].pct = base > 0 ? Math.round((m[c].viva / base) * 1000) / 10 : null;
    });
  }
  return meses;
}
