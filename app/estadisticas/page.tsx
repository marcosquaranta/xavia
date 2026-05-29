import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
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
  } catch (e: any) { err = e?.message || 'Error cargando datos'; }

  if (err) return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const anioAnterior = anioActual - 1;
  const nombreMes = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const varActivas = variedades.filter((v) => v.activo === 'SI');

  // Calcular curvas de forma segura
  let statsActual: any[] = [];
  let statsPasado: any[] = [];
  let curvas: any[] = [];
  let errDetalle: string | null = null;

  try {
    // Importar funciones dinámicamente para capturar errores de módulo
    const { estadisticasDelMes, ciclosPorMesYAnio } = await import('@/lib/estadisticas');
    const mesPasado = new Date(hoy); mesPasado.setMonth(mesPasado.getMonth() - 1);

    try { statsActual = estadisticasDelMes(lotes, movimientos, hoy); } catch (e: any) { errDetalle = 'estadísticas: ' + e?.message; }
    try { statsPasado = estadisticasDelMes(lotes, movimientos, mesPasado); } catch {}

    try {
      const cA = ciclosPorMesYAnio(lotes, movimientos, anioActual);
      const cAnt = ciclosPorMesYAnio(lotes, movimientos, anioAnterior);
      for (const v of varActivas) {
        const datosActual = Array.from((cA.get(v.variedad) || new Map<number,number>()).entries()).filter(([k]) => k < 12) as [number,number][];
        const datosAnterior = Array.from((cAnt.get(v.variedad) || new Map<number,number>()).entries()).filter(([k]) => k < 12) as [number,number][];
        if (datosActual.length > 0 || datosAnterior.length > 0) curvas.push({ variedad: v.variedad, datosActual, datosAnterior });
      }
    } catch (e: any) { errDetalle = (errDetalle || '') + ' | curvas: ' + e?.message; }
  } catch (e: any) { errDetalle = 'importación: ' + e?.message; }

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <h1 className="page-title">Estadísticas</h1>
        <p className="page-subtitle">{nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}</p>

        {errDetalle && (
          <div className="alert-box error" style={{ marginBottom: '16px', fontSize: '12px' }}>
            Error interno: {errDetalle}
          </div>
        )}

        {/* Gráfico evolución */}
        <div className="card">
          <p className="card-title">Evolución de ciclos · {anioActual} vs {anioAnterior}</p>
          <p className="card-sub">Días promedio de ciclo total por mes · todas las variedades. Punteado = año anterior.</p>
          <GraficoEvolucion curvas={curvas} anioActual={anioActual} anioAnterior={anioAnterior} />
        </div>

        {/* Tabla resumen */}
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
