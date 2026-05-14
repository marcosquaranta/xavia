import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { estadisticasDelMes, ciclosPorMesYAnio } from '@/lib/estadisticas';
import type { Lote, Movimiento, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from './GraficoEvolucion';
import SelectorVariedad from './SelectorVariedad';
export const dynamic = 'force-dynamic';
export default async function EstadisticasPage({ searchParams }: { searchParams: { variedad?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  let lotes: Lote[] = [], movimientos: Movimiento[] = [], variedades: Variedad[] = [];
  let err: string | null = null;
  try { [lotes, movimientos, variedades] = await Promise.all([readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Variedad>('Variedades')]); } catch (e: any) { err = e?.message || 'Error'; }
  if (err) return <><Header user={user} current="estadisticas" /><div className="container"><div className="alert-box error">{err}</div></div></>;
  const hoy = new Date();
  const mesPasado = new Date(hoy); mesPasado.setMonth(mesPasado.getMonth() - 1);
  const varActivas = variedades.filter((v) => v.activo === 'SI');
  const varSel = searchParams.variedad || varActivas[0]?.variedad || 'Lechuga Crespa';
  let statsActual: any[] = [], statsPasado: any[] = [];
  let datosActual: [number, number][] = [], datosAnterior: [number, number][] = [];
  try { statsActual = estadisticasDelMes(lotes, movimientos, hoy); statsPasado = estadisticasDelMes(lotes, movimientos, mesPasado); } catch {}
  try {
    const anioA = hoy.getFullYear(); const anioAnt = anioA - 1;
    const cA = ciclosPorMesYAnio(lotes, movimientos, anioA); const cAnt = ciclosPorMesYAnio(lotes, movimientos, anioAnt);
    datosActual = Array.from((cA.get(varSel) || new Map()).entries()).filter(([k]) => k < 12) as [number, number][];
    datosAnterior = Array.from((cAnt.get(varSel) || new Map()).entries()).filter(([k]) => k < 12) as [number, number][];
  } catch {}
  const anioActual = hoy.getFullYear();
  const anioAnterior = anioActual - 1;
  const nombreMes = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <h1 className="page-title">Estadísticas</h1>
        <p className="page-subtitle">Vista agregada · {nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}</p>
        <div className="card">
          <p className="card-title">Evolución de ciclos · {anioActual} vs {anioAnterior}</p>
          <p className="card-sub">Días promedio de ciclo total por mes.</p>
          <SelectorVariedad variedades={varActivas.map((v) => v.variedad)} seleccionada={varSel} />
          <GraficoEvolucion datosActual={datosActual} datosAnterior={datosAnterior} anioActual={anioActual} anioAnterior={anioAnterior} />
        </div>
        <div className="card">
          <p className="card-title">Ciclo y producción por variedad — mes actual vs anterior</p>
          {statsActual.length === 0 ? <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>No hay cosechas registradas este mes todavía.</p> : (
            <table>
              <thead><tr><th>Variedad</th><th style={{ textAlign: 'right' }}>Cosechado</th><th style={{ textAlign: 'right' }}>vs mes ant.</th><th style={{ textAlign: 'right' }}>Ciclo prom.</th><th style={{ textAlign: 'right' }}>vs mes ant.</th><th style={{ textAlign: 'right' }}>Rend. (kg/u)</th></tr></thead>
              <tbody>
                {statsActual.map((s) => {
                  const ant = statsPasado.find((x: any) => x.variedad === s.variedad);
                  const dC = ant ? Math.round(((s.cosechado - ant.cosechado) / Math.max(1, ant.cosechado)) * 100) : 0;
                  const dCi = ant ? s.ciclo_promedio - ant.ciclo_promedio : 0;
                  return (
                    <tr key={s.variedad}>
                      <td>{s.variedad}</td>
                      <td style={{ textAlign: 'right' }}>{s.cosechado.toLocaleString('es-AR')}</td>
                      <td style={{ textAlign: 'right', color: dC > 0 ? '#059669' : dC < 0 ? '#dc2626' : '#6b7280' }}>{ant ? (dC >= 0 ? '↑' : '↓') + ' ' + Math.abs(dC) + '%' : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{s.ciclo_promedio} d</td>
                      <td style={{ textAlign: 'right', color: dCi < 0 ? '#059669' : dCi > 0 ? '#dc2626' : '#6b7280' }}>{ant ? (dCi > 0 ? '↑' : dCi < 0 ? '↓' : '→') + ' ' + Math.abs(dCi) + ' d' : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{typeof s.rendimiento_kg_por_unidad === 'number' ? s.rendimiento_kg_por_unidad.toFixed(3) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}