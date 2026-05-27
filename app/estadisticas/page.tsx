import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { estadisticasDelMes, ciclosPorMesYAnio } from '@/lib/estadisticas';
import type { Lote, Movimiento, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from './GraficoEvolucion';
export const dynamic = 'force-dynamic';

export default async function EstadisticasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], variedades: Variedad[] = [];
  let err: string | null = null;
  try {
    [lotes, movimientos, variedades] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Variedad>('Variedades'),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }

  if (err) return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const hoy = new Date();
  const mesPasado = new Date(hoy);
  mesPasado.setMonth(mesPasado.getMonth() - 1);
  const anioActual = hoy.getFullYear();
  const anioAnterior = anioActual - 1;
  const nombreMes = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  const varActivas = variedades.filter((v) => v.activo === 'SI');

  let statsActual: any[] = [], statsPasado: any[] = [];
  try {
    statsActual = estadisticasDelMes(lotes, movimientos, hoy);
    statsPasado = estadisticasDelMes(lotes, movimientos, mesPasado);
  } catch {}

  // Construir curvas para todas las variedades activas
  const curvas: { variedad: string; datosActual: [number, number][]; datosAnterior: [number, number][] }[] = [];
  try {
    const cA = ciclosPorMesYAnio(lotes, movimientos, anioActual);
    const cAnt = ciclosPorMesYAnio(lotes, movimientos, anioAnterior);
    for (const v of varActivas) {
      const datosActual = Array.from((cA.get(v.variedad) || new Map()).entries())
        .filter(([k]) => k < 12) as [number, number][];
      const datosAnterior = Array.from((cAnt.get(v.variedad) || new Map()).entries())
        .filter(([k]) => k < 12) as [number, number][];
      if (datosActual.length > 0 || datosAnterior.length > 0) {
        curvas.push({ variedad: v.variedad, datosActual, datosAnterior });
      }
    }
  } catch {}

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <h1 className="page-title">Estadísticas</h1>
        <p className="page-subtitle">Vista agregada · {nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}</p>

        {/* Gráfico evolución de ciclos — todas las variedades */}
        <div className="card">
          <p className="card-title">Evolución de ciclos · {anioActual} vs {anioAnterior}</p>
          <p className="card-sub">Días promedio de ciclo total por mes · todas las variedades.</p>
          <GraficoEvolucion curvas={curvas} anioActual={anioActual} anioAnterior={anioAnterior} />
        </div>

        {/* Tabla resumen mes actual vs anterior */}
        <div className="card">
          <p className="card-title">Ciclo y producción por variedad — mes actual vs anterior</p>
          {statsActual.length === 0
            ? <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>No hay cosechas registradas este mes todavía.</p>
            : (
              <table>
                <thead>
                  <tr>
                    <th>Variedad</th>
                    <th style={{ textAlign: 'right' }}>Cosechado</th>
                    <th style={{ textAlign: 'right' }}>vs mes ant.</th>
                    <th style={{ textAlign: 'right' }}>Ciclo prom.</th>
                    <th style={{ textAlign: 'right' }}>vs mes ant.</th>
                    <th style={{ textAlign: 'right' }}>Rend. (kg/u)</th>
                  </tr>
                </thead>
                <tbody>
                  {statsActual.map((s: any) => {
                    const ant = statsPasado.find((x: any) => x.variedad === s.variedad);
                    const diffUnid = ant ? s.unidades - ant.unidades : null;
                    const diffCiclo = ant ? s.ciclo_prom - ant.ciclo_prom : null;
                    return (
                      <tr key={s.variedad}>
                        <td>{s.variedad}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{s.unidades.toLocaleString('es-AR')} {s.tipo_unidad}</td>
                        <td style={{ textAlign: 'right', color: diffUnid === null ? '#9ca3af' : diffUnid >= 0 ? '#059669' : '#dc2626' }}>
                          {diffUnid === null ? '—' : (diffUnid >= 0 ? '+' : '') + diffUnid.toLocaleString('es-AR')}
                        </td>
                        <td style={{ textAlign: 'right' }}>{s.ciclo_prom > 0 ? s.ciclo_prom + 'd' : '—'}</td>
                        <td style={{ textAlign: 'right', color: diffCiclo === null ? '#9ca3af' : diffCiclo <= 0 ? '#059669' : '#dc2626' }}>
                          {diffCiclo === null ? '—' : (diffCiclo > 0 ? '+' : '') + diffCiclo + 'd'}
                        </td>
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>
                          {s.rendimiento_kg > 0 ? s.rendimiento_kg.toFixed(3) : '—'}
                        </td>
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
