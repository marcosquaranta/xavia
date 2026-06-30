// ── Constantes del modelo (criterio de Marcelo) ──
export const CUB = 345, POSPAQ = 3, CUBPOSRUC = 2, CUBPLLEC = 1;
export const DIA_SIEMBRA = 3; // miércoles
export const lotesConv = (d: number) => Math.round(d / 7);
export const DIAS = [
  { n: 1, l: 'Lun', full: 'LUNES' }, { n: 2, l: 'Mar', full: 'MARTES' }, { n: 3, l: 'Mié', full: 'MIÉRCOLES' },
  { n: 4, l: 'Jue', full: 'JUEVES' }, { n: 5, l: 'Vie', full: 'VIERNES' }, { n: 6, l: 'Sáb', full: 'SÁBADO' },
];

export type Cultivo = 'lechuga' | 'rucula';
export interface Slot { cultivo: Cultivo; dia: number; pct: number } // dia 1=Lun … 6=Sáb
export const REPARTO_DEFAULT: Slot[] = [
  { cultivo: 'lechuga', dia: 1, pct: 35 }, { cultivo: 'lechuga', dia: 4, pct: 30 }, { cultivo: 'lechuga', dia: 5, pct: 35 },
  { cultivo: 'rucula', dia: 2, pct: 45 }, { cultivo: 'rucula', dia: 5, pct: 55 },
];

export interface Cap {
  ruc: number; rucPerfTot: number; rucPosPerf: number;
  lecF2PerfTot: number; lecPosPerf: number;
  lecF1PerfTot: number; lecF1PosPerf: number;
}
export interface NavesCap { 1: Cap; 2: Cap }
export interface Dias { rucDias: number; lecF2Dias: number; lecF1Dias: number }

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

export interface PlanNave { rucPos: number; rucPaq: number; rucPl: number; lote: number; lecPl: number; f1PerfNec: number; f1OK: number; rucTrasp: number; f1Trasp: number; f2Trasp: number }
export interface Plan {
  n1: PlanNave; n2: PlanNave;
  totRucPaq: number; totRucPl: number; totLecPlantas: number; totLecPl: number;
  rl: number; f2l: number; f1l: number;
}

export function calcularPlan(naves: NavesCap, dias: Dias): Plan {
  const rl = lotesConv(dias.rucDias), f2l = lotesConv(dias.lecF2Dias), f1l = lotesConv(dias.lecF1Dias);
  const nave = (c: Cap): PlanNave => {
    const rucPos = c.ruc / Math.max(1, rl);
    const rucPaq = rucPos / POSPAQ;
    const rucPl = rucPos * CUBPOSRUC / CUB;
    const lote = (c.lecF2PerfTot / Math.max(1, f2l)) * c.lecPosPerf;
    const lecPl = lote * CUBPLLEC / CUB;
    const f1PerfNec = Math.ceil(lote / Math.max(1, c.lecF1PosPerf) * f1l);
    const f1OK = c.lecF1PerfTot - f1PerfNec;
    const rucTrasp = Math.ceil(rucPos / Math.max(1, c.rucPosPerf));
    const f1Trasp = Math.ceil(lote / Math.max(1, c.lecF1PosPerf));
    const f2Trasp = Math.ceil(lote / Math.max(1, c.lecPosPerf));
    return { rucPos, rucPaq, rucPl, lote, lecPl, f1PerfNec, f1OK, rucTrasp, f1Trasp, f2Trasp };
  };
  const n1 = nave(naves[1]), n2 = nave(naves[2]);
  return {
    n1, n2, rl, f2l, f1l,
    totRucPaq: n1.rucPaq + n2.rucPaq, totRucPl: n1.rucPl + n2.rucPl,
    totLecPlantas: n1.lote + n2.lote, totLecPl: n1.lecPl + n2.lecPl,
  };
}

// ── Helpers del reparto (compartidos por cronograma y tareas) ──
export function repartoHelpers(plan: Plan, reparto: Slot[]) {
  const totSemana = (c: Cultivo) => c === 'lechuga' ? plan.totLecPlantas : plan.totRucPaq;
  const naveSemana = (c: Cultivo, nave: 1 | 2) => c === 'lechuga' ? (nave === 1 ? plan.n1.lote : plan.n2.lote) : (nave === 1 ? plan.n1.rucPaq : plan.n2.rucPaq);
  const pctDia = (c: Cultivo, dia: number) => reparto.filter(s => s.cultivo === c && s.dia === dia).reduce((a, s) => a + s.pct, 0);
  const cosDia = (c: Cultivo, dia: number) => totSemana(c) * pctDia(c, dia) / 100;
  const cosNaveDia = (c: Cultivo, nave: 1 | 2, dia: number) => naveSemana(c, nave) * pctDia(c, dia) / 100;
  const sumPct = (c: Cultivo) => reparto.filter(s => s.cultivo === c).reduce((a, s) => a + s.pct, 0);
  const cosechaEnDia = (dia: number) => pctDia('lechuga', dia) > 0 || pctDia('rucula', dia) > 0;
  const trasplanteEnDia = (dia: number) => dia === DIA_SIEMBRA || (dia > 1 && cosechaEnDia(dia - 1));
  const siembraRucPl = plan.n1.rucPos * CUBPOSRUC / CUB + plan.n2.rucPos * CUBPOSRUC / CUB;
  const siembraLecPl = plan.n1.lote / CUB + plan.n2.lote / CUB;
  return { pctDia, cosDia, cosNaveDia, sumPct, cosechaEnDia, trasplanteEnDia, siembraRucPl, siembraLecPl };
}

export interface Tarea { icon: string; txt: string; color: string }

// jsDay: 0=Dom … 6=Sáb (Date.getDay())
export function tareasDelDia(plan: Plan, reparto: Slot[], jsDay: number): Tarea[] {
  const dia = jsDay === 0 ? 0 : jsDay;
  if (dia < 1 || dia > 6) return [];
  const h = repartoHelpers(plan, reparto);
  const t: Tarea[] = [];
  if (h.pctDia('lechuga', dia) > 0) t.push({ icon: '🥬', color: '#4d7c0f', txt: `Cosechar ~${fmt(h.cosDia('lechuga', dia))} plantas de lechuga — N1 ${fmt(h.cosNaveDia('lechuga', 1, dia))} · N2 ${fmt(h.cosNaveDia('lechuga', 2, dia))}` });
  if (h.pctDia('rucula', dia) > 0) t.push({ icon: '🌿', color: '#ca8a04', txt: `Cosechar ~${fmt(h.cosDia('rucula', dia))} paquetes de rúcula — N1 ${fmt(h.cosNaveDia('rucula', 1, dia))} · N2 ${fmt(h.cosNaveDia('rucula', 2, dia))}` });
  if (dia === DIA_SIEMBRA) t.push({ icon: '🌱', color: '#0891b2', txt: `Sembrar ${h.siembraRucPl.toFixed(0)} planchas de rúcula + ${h.siembraLecPl.toFixed(1)} de lechuga` });
  if (h.trasplanteEnDia(dia)) t.push({ icon: '🔄', color: '#7c3aed', txt: `Trasplantar a perfiles liberados (F1→F2 lechuga, plantinera→perfil rúcula${dia === DIA_SIEMBRA ? ', plantinera→F1' : ''})` });
  if (h.cosechaEnDia(dia)) t.push({ icon: '🧽', color: '#6b7280', txt: 'Lavar los perfiles cosechados' });
  if (dia === 5 || dia === 6) t.push({ icon: '📦', color: '#2563eb', txt: 'Hacer control de stock de rúculas y lechugas' });
  return t;
}

// Sanitiza un reparto venido de storage (JSON) — descarta entradas inválidas.
export function parseReparto(raw: any): Slot[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return REPARTO_DEFAULT;
    const ok = arr.filter((s: any) => (s.cultivo === 'lechuga' || s.cultivo === 'rucula') && Number(s.dia) >= 1 && Number(s.dia) <= 6)
      .map((s: any) => ({ cultivo: s.cultivo as Cultivo, dia: Number(s.dia), pct: Number(s.pct) || 0 }));
    return ok.length ? ok : REPARTO_DEFAULT;
  } catch { return REPARTO_DEFAULT; }
}
