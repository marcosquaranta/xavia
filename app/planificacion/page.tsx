import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { diasPromedioPorVariedad } from '@/lib/estadisticas';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import PlanificacionManager from './PlanificacionManager';

export const dynamic = 'force-dynamic';

export interface CapacidadNave {
  ruc: number; rucPerfTot: number; rucPosPerf: number;
  lecF2PerfTot: number; lecPosPerf: number;
  lecF1PerfTot: number; lecF1PosPerf: number;
}

const esRuculaVar = (v: string) => { const x = String(v).toLowerCase(); return x.includes('rucula') || x.includes('rúcula'); };

export default async function PlanificacionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [];
  let err: string | null = null;
  try {
    [lotes, movimientos, ubicaciones] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones'),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }

  if (err) return (<><Header user={user} current="planificacion" /><div className="container"><div className="alert-box error">{err}</div></div></>);

  // ── Capacidad por nave desde Ubicaciones ──
  const mesadas = ubicaciones.filter(u => u.tipo === 'mesada' && u.activo === 'SI');
  const perf = (m: Ubicacion) => (Number(m.modulos) || 1) * (Number(m.perfiles_por_modulo) || 0);
  const pos = (m: Ubicacion) => perf(m) * (Number(m.orificios_por_perfil) || 0);

  function capacidad(nave: number): CapacidadNave {
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
  }
  const naves = { 1: capacidad(1), 2: capacidad(2) };

  // ── Días de ciclo default = promedio real de las cosechas ──
  const est = diasPromedioPorVariedad(lotes, movimientos, 120);
  const avg = (arr: any[], key: string) => {
    const vals = arr.map(d => Number(d[key])).filter(v => v && v > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };
  const lechEst = est.filter(d => !esRuculaVar(d.variedad));
  const rucEst = est.filter(d => esRuculaVar(d.variedad));
  const defaults = {
    rucDias: avg(rucEst, 'fase_2') || avg(rucEst, 'total') || 32,
    lecF2Dias: avg(lechEst, 'fase_2') || 35,
    lecF1Dias: avg(lechEst, 'fase_1') || 25,
  };

  return (
    <>
      <Header user={user} current="planificacion" />
      <div className="container">
        <h1 className="page-title">Planificación y Producción</h1>
        <p className="page-subtitle">Cuánto sembrar por semana según el ciclo, alimentado por la capacidad real de las naves y el promedio de cosechas.</p>
        <PlanificacionManager naves={naves} defaults={defaults} />
      </div>
    </>
  );
}
