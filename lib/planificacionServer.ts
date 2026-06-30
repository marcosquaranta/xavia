import type { Lote, Movimiento, Ubicacion } from './types';
import { diasPromedioPorVariedad } from './estadisticas';
import type { Cap, NavesCap, Dias } from './planificacion';

const esRuculaVar = (v: string) => { const x = String(v).toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };

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

// ── Días de ciclo default = promedio real de las cosechas ──
export function diasCicloDefault(lotes: Lote[], movimientos: Movimiento[]): Dias {
  const est = diasPromedioPorVariedad(lotes, movimientos, 120);
  const avg = (arr: any[], key: string) => {
    const vals = arr.map(d => Number(d[key])).filter(v => v && v > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };
  const lechEst = est.filter(d => !esRuculaVar(d.variedad));
  const rucEst = est.filter(d => esRuculaVar(d.variedad));
  return {
    rucDias: avg(rucEst, 'fase_2') || avg(rucEst, 'total') || 32,
    lecF2Dias: avg(lechEst, 'fase_2') || 35,
    lecF1Dias: avg(lechEst, 'fase_1') || 25,
  };
}
