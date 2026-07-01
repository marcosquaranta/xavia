import type { Lote, Movimiento, Ubicacion } from './types';
import { diasPromedioPorVariedad } from './estadisticas';
import { calcularDiasPorFase } from './lotes';
import type { Cap, NavesCap, Dias, Tarea } from './planificacion';

const esRuculaVar = (v: string) => { const x = String(v).toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };

// ── Trasplantes reales del día: lotes activos que ya cumplieron (o pasaron) su fase ──
// Agrupa por transición (plantinera→F1, F1→F2) listando los IDs de lote.
export function trasplantesDelDia(lotes: Lote[], movimientos: Movimiento[]): Tarea[] {
  const estMap = new Map(diasPromedioPorVariedad(lotes, movimientos, 120).map(d => [d.variedad, d]));
  const activos = lotes.filter(l => l.estado === 'activo');
  const naveDe = (u: string) => /nave\s*2/i.test(String(u)) ? 2 : 1;
  const grupos: Record<string, { de: string; lotes: { id: string; nave: number; faltan: number }[] }> = {};
  for (const l of activos) {
    let dias: any;
    try { dias = calcularDiasPorFase(l, movimientos); } catch { continue; }
    const est = estMap.get(l.variedad);
    let de = '', a = '', faltan = 99;
    if (l.fase_actual === 'plantin') {
      const e = est?.plantinera || 10; faltan = e - dias.plantinera; de = 'plantinera'; a = 'Fase 1';
    } else if (l.fase_actual === 'fase_1') {
      const e = est?.fase_1 || 22; faltan = e - (dias.fase_1 || 0); de = 'Fase 1'; a = 'Fase 2';
    } else continue;
    if (faltan > 0) continue; // solo los que ya están listos / atrasados
    (grupos[a] ??= { de, lotes: [] }).lotes.push({ id: l.id_lote, nave: naveDe(l.ubicacion_actual), faltan });
  }
  return Object.entries(grupos).map(([a, g]) => {
    const ids = g.lotes.sort((x, y) => x.faltan - y.faltan).map(x => x.id).join(', ');
    return { icon: '🔄', color: '#7c3aed', txt: `Trasplantar de ${g.de} → ${a}: ${ids}` };
  });
}

// ── Capacidad por nave desde Ubicaciones ──
export function calcularCapacidad(ubicaciones: Ubicacion[]): NavesCap {
  const mesadas = ubicaciones.filter(u => u.tipo === 'mesada' && u.activo === 'SI');
  const perf = (m: Ubicacion) => (Number(m.modulos) || 1) * (Number(m.perfiles_por_modulo) || 0);
  const pos = (m: Ubicacion) => perf(m) * (Number(m.orificios_por_perfil) || 0);
  const cap = (nave: number): Cap => {
    const enNave = mesadas.filter(m => Number(m.nave) === nave);
    const ruc = enNave.filter(m => m.variedad_asignada === 'rucula' || m.variedad_asignada === 'mixta');
    const lecF2 = enNave.filter(m => m.variedad_asignada === 'lechuga' && m.sector_fase === 'fase_2');
    const lecF1 = enNave.filter(m => m.variedad_asignada === 'lechuga' && m.sector_fase === 'fase_1');
    const rucPerfTot = ruc.reduce((a, m) => a + perf(m), 0);
    const rucPos = ruc.reduce((a, m) => a + pos(m), 0);
    const lecF2PerfTot = lecF2.reduce((a, m) => a + perf(m), 0);
    const lecF2Pos = lecF2.reduce((a, m) => a + pos(m), 0);
    const lecF1PerfTot = lecF1.reduce((a, m) => a + perf(m), 0);
    const lecF1Pos = lecF1.reduce((a, m) => a + pos(m), 0);
    return {
      ruc: rucPos, rucPerfTot, rucPosPerf: rucPerfTot ? Math.round((rucPos / rucPerfTot) * 10) / 10 : 22,
      lecF2PerfTot, lecPosPerf: lecF2PerfTot ? Math.round(lecF2Pos / lecF2PerfTot) : 13,
      lecF1PerfTot, lecF1PosPerf: lecF1PerfTot ? Math.round(lecF1Pos / lecF1PerfTot) : 40,
    };
  };
  return { 1: cap(1), 2: cap(2) };
}

function fmtFechaCorta(f: any): string {
  const s = String(f || '').split(/[T ]/)[0];
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
}

// ── Días de ciclo default = del ÚLTIMO lote cosechado de cada cultivo (no un promedio) ──
// Así refleja el ciclo real más reciente. Sigue siendo editable en la UI para simular.
export function diasCicloDefault(lotes: Lote[], movimientos: Movimiento[]): Dias {
  const cosechados = lotes
    .filter(l => l.estado === 'cosechado' && l.fecha_cosecha)
    .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')));
  const ultimoRucula = cosechados.find(l => esRuculaVar(l.variedad));
  const ultimoLechuga = cosechados.find(l => !esRuculaVar(l.variedad));
  const dR = ultimoRucula ? calcularDiasPorFase(ultimoRucula, movimientos) : null;
  const dL = ultimoLechuga ? calcularDiasPorFase(ultimoLechuga, movimientos) : null;

  return {
    rucDias: (dR?.fase_2 || dR?.total) || 32,
    lecF2Dias: dL?.fase_2 || 35,
    lecF1Dias: dL?.fase_1 || 25,
    rucFuente: ultimoRucula ? `último lote ${ultimoRucula.id_lote} · cosechado ${fmtFechaCorta(ultimoRucula.fecha_cosecha)}` : 'sin cosechas registradas, valor por defecto',
    lecFuente: ultimoLechuga ? `último lote ${ultimoLechuga.id_lote} · cosechado ${fmtFechaCorta(ultimoLechuga.fecha_cosecha)}` : 'sin cosechas registradas, valor por defecto',
  };
}
