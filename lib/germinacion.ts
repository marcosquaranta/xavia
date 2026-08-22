import type { Lote, Movimiento } from './types';
import { clasificarCultivoDescarte, type CultivoDescarte } from './descarte';

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export interface GerminacionCultivo { pctGerminacion: number | null; pctSupervivenciaPostTrasplante: number | null }
export interface GerminacionMes {
  mes: string; label: string;
  rucula: GerminacionCultivo; lechuga_crespa: GerminacionCultivo; lechuga_roble: GerminacionCultivo;
}

interface Acc { sobreviveGerm: number; pierdeGerm: number; sobrevivePost: number; pierdePost: number }
function cero(): Acc { return { sobreviveGerm: 0, pierdeGerm: 0, sobrevivePost: 0, pierdePost: 0 }; }

// Germinación (proxy) = % de plantines sembrados que llega vivo al primer trasplante
// (Plantín→F1). Es una aproximación, no germinación pura: mezcla semillas que no
// germinaron con plantines que sí germinaron pero se perdieron en la plantinera antes del
// trasplante — hoy no hay un conteo intermedio propio de germinación, así que este es el
// dato más cercano disponible sin agregar un paso de carga nuevo (a pedido explícito: usar
// lo que ya existe en vez de sumar trabajo de campo).
//
// Supervivencia post-trasplante = % de lo que entra a F1 que llega vivo a cosecha, sumando
// las dos etapas de ahí en adelante (F1→F2 y F2→Cosecha) — esto sí es preciso, no un proxy:
// sale directo de Movimientos, misma fuente que "Descarte por fase".
export function germinacionYSupervivenciaPorMes(lotes: Lote[], movimientos: Movimiento[], nMeses = 12): GerminacionMes[] {
  const hoy = new Date();
  const meses: GerminacionMes[] = [];
  for (let i = nMeses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    meses.push({ mes, label: `${MESES_CORTO[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, rucula: { pctGerminacion: null, pctSupervivenciaPostTrasplante: null }, lechuga_crespa: { pctGerminacion: null, pctSupervivenciaPostTrasplante: null }, lechuga_roble: { pctGerminacion: null, pctSupervivenciaPostTrasplante: null } });
  }
  const idxPorMes = new Map(meses.map((m, i) => [m.mes, i]));
  const lotesMap = new Map(lotes.map((l) => [l.id_lote, l]));

  const acc: Record<string, Acc> = {};
  function get(idx: number, cultivo: CultivoDescarte): Acc {
    const key = `${idx}||${cultivo}`;
    if (!acc[key]) acc[key] = cero();
    return acc[key];
  }

  for (const m of movimientos) {
    const lote = lotesMap.get(String(m.id_lote || '')); if (!lote) continue;
    const cultivo = clasificarCultivoDescarte(lote.variedad); if (!cultivo) continue;
    const mk = String(m.fecha || '').slice(0, 7);
    const idx = idxPorMes.get(mk); if (idx === undefined) continue;
    const descarte = Number(m.descarte_calculado) || 0;

    if (m.tipo === 'trasplante' && m.fase_origen === 'plantin' && m.fase_destino === 'fase_1') {
      const sobrevive = Number(m.plantas_estimadas) || 0;
      if (sobrevive > 0 || descarte > 0) { const a = get(idx, cultivo); a.sobreviveGerm += sobrevive; a.pierdeGerm += descarte; }
    } else if (m.tipo === 'trasplante' && m.fase_origen === 'fase_1' && m.fase_destino === 'fase_2') {
      const sobrevive = Number(m.plantas_estimadas) || 0;
      if (sobrevive > 0 || descarte > 0) { const a = get(idx, cultivo); a.sobrevivePost += sobrevive; a.pierdePost += descarte; }
    } else if (m.tipo === 'cosecha') {
      const esRucula = cultivo === 'rucula';
      const cosechado = Number(m.unidades_cosechadas) || 0;
      const sobrevive = esRucula ? cosechado * (Number(lote.plantas_por_unidad_real) || 3) : cosechado;
      if (sobrevive > 0 || descarte > 0) { const a = get(idx, cultivo); a.sobrevivePost += sobrevive; a.pierdePost += descarte; }
    }
  }

  for (let idx = 0; idx < meses.length; idx++) {
    for (const cultivo of ['rucula', 'lechuga_crespa', 'lechuga_roble'] as const) {
      const a = acc[`${idx}||${cultivo}`];
      if (!a) continue;
      const baseGerm = a.sobreviveGerm + a.pierdeGerm;
      const basePost = a.sobrevivePost + a.pierdePost;
      meses[idx][cultivo] = {
        pctGerminacion: baseGerm > 0 ? Math.round((a.sobreviveGerm / baseGerm) * 1000) / 10 : null,
        pctSupervivenciaPostTrasplante: basePost > 0 ? Math.round((a.sobrevivePost / basePost) * 1000) / 10 : null,
      };
    }
  }
  return meses;
}

// Versión "resumen home" — un solo % combinado entre los 3 cultivos (no abierto por
// cultivo), para un mes calendario puntual — mismo criterio que otros indicadores del
// panel que muestran un número único (Productividad, Descartes). Pondera por cantidad de
// plantas, no promedia los 3 % de cada cultivo (eso pesaría igual un cultivo con 10
// plantines que uno con 10.000).
export function germinacionYSupervivenciaMes(lotes: Lote[], movimientos: Movimiento[], fechaRef: Date): { pctGerminacion: number | null; pctSupervivenciaPostTrasplante: number | null } {
  const mk = `${fechaRef.getFullYear()}-${String(fechaRef.getMonth() + 1).padStart(2, '0')}`;
  const lotesMap = new Map(lotes.map((l) => [l.id_lote, l]));
  let sobreviveGerm = 0, pierdeGerm = 0, sobrevivePost = 0, pierdePost = 0;

  for (const m of movimientos) {
    if (String(m.fecha || '').slice(0, 7) !== mk) continue;
    const lote = lotesMap.get(String(m.id_lote || '')); if (!lote) continue;
    const cultivo = clasificarCultivoDescarte(lote.variedad); if (!cultivo) continue;
    const descarte = Number(m.descarte_calculado) || 0;

    if (m.tipo === 'trasplante' && m.fase_origen === 'plantin' && m.fase_destino === 'fase_1') {
      sobreviveGerm += Number(m.plantas_estimadas) || 0; pierdeGerm += descarte;
    } else if (m.tipo === 'trasplante' && m.fase_origen === 'fase_1' && m.fase_destino === 'fase_2') {
      sobrevivePost += Number(m.plantas_estimadas) || 0; pierdePost += descarte;
    } else if (m.tipo === 'cosecha') {
      const esRucula = cultivo === 'rucula';
      const cosechado = Number(m.unidades_cosechadas) || 0;
      sobrevivePost += esRucula ? cosechado * (Number(lote.plantas_por_unidad_real) || 3) : cosechado;
      pierdePost += descarte;
    }
  }
  const baseGerm = sobreviveGerm + pierdeGerm, basePost = sobrevivePost + pierdePost;
  return {
    pctGerminacion: baseGerm > 0 ? Math.round((sobreviveGerm / baseGerm) * 1000) / 10 : null,
    pctSupervivenciaPostTrasplante: basePost > 0 ? Math.round((sobrevivePost / basePost) * 1000) / 10 : null,
  };
}
