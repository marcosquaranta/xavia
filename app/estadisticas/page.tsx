// app/estadisticas/page.tsx
// Estadísticas con gráfico de evolución anual y comparaciones mensuales.

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import {
  estadisticasDelMes,
  ciclosPorMesYAnio,
} from '@/lib/estadisticas';
import type { Lote, Movimiento, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from './GraficoEvolucion';

export const dynamic = 'force-dynamic';

export default async function EstadisticasPage({
  searchParams,
}: {
  searchParams: { variedad?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [lotes, movimientos, variedades] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Movimiento>('Movimientos'),
    readSheet<Variedad>('Variedades'),
  ]);

  const hoy = new Date();
  const mesPasado = new Date(hoy);
  mesPasado.setMonth(mesPasado.getMonth() - 1);

  const statsMesActual = estadisticasDelMes(lotes, movimientos, hoy);
  const statsMesPasado = estadisticasDelMes(lotes, movimientos, mesPasado);

  const variedadSeleccionada =
    searchParams.variedad ||
    variedades.find((v) => v.activo === 'SI')?.variedad ||
    'Lechuga Crespa';

  const anioActual = hoy.getFullYear();
  const anioAnterior = anioActual - 1;
  const ciclosActual = ciclosPorMesYAnio(lotes, movimientos, anioActual);
  const ciclosAnterior = ciclosPorMesYAnio(lotes, movimientos, anioAnterior);

  const datosActual = ciclosActual.get(variedadSeleccionada) || new Map();
  const datosAnterior = ciclosAnterior.get(variedadSeleccionada) || new Map();

  const variedadesActivas = variedades.filter((v) => v.activo === 'SI');

  const nombreMes = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <h1 className="page-title">Estadísticas</h1>
        <p className="page-subtitle">
          Vista agregada · {nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}
        </p>

        <div className="card">
          <p className="card-title">
            Evolución de tiempos por fase · {anioActual} vs {anioAnterior}
          </p>
          <p className="card-sub">
            Compará cómo viene cada fase del cultivo este año contra el anterior.
          </p>

          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '14px',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
              }}
            >
              Variedad:
            </span>
            <form action="/estadisticas" method="GET" style={{ display: 'inline-flex', gap: '8px' }}>
              <select
                name="variedad"
                defaultValue={variedadSeleccionada}
                onChange={(e) => e.currentTarget.form?.submit()}
                style={{ padding: '5px 8px', fontSize: '12px', maxWidth: '220px' }}
              >
                {variedadesActivas.map((v) => (
                  <option key={v.variedad} value={v.variedad}>
                    {v.variedad}
                  </option>
                ))}
              </select>
            </form>
          </div>

          <GraficoEvolucion
            datosActual={Array.from(datosActual.entries()).filter(
              ([k]) => k < 12
            )}
            datosAnterior={Array.from(datosAnterior.entries()).filter(
              ([k]) => k < 12
            )}
            anioActual={anioActual}
            anioAnterior={anioAnterior}
          />
        </div>

        <div className="card">
          <p className="card-title">Ciclo y producción por variedad (mes actual vs anterior)</p>
          {statsMesActual.length === 0 ? (
            <p
              style={{
                color: '#9ca3af',
                fontSize: '13px',
                textAlign: 'center',
                padding: '20px',
              }}
            >
              No hay cosechas registradas este mes todavía.
            </p>
          ) : (
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
                {statsMesActual.map((s) => {
                  const ant = statsMesPasado.find((x) => x.variedad === s.variedad);
                  const diffCosechado = ant
                    ? Math.round(((s.cosechado - ant.cosechado) / Math.max(1, ant.cosechado)) * 100)
                    : 0;
                  const diffCiclo = ant ? s.ciclo_promedio - ant.ciclo_promedio : 0;
                  return (
                    <tr key={s.variedad}>
                      <td>{s.variedad}</td>
                      <td style={{ textAlign: 'right' }}>
                        {s.cosechado.toLocaleString('es-AR')}
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          color:
                            diffCosechado > 0
                              ? '#059669'
                              : diffCosechado < 0
                              ? '#dc2626'
                              : '#6b7280',
                        }}
                      >
                        {ant ? `${diffCosechado >= 0 ? '↑' : '↓'} ${Math.abs(diffCosechado)}%` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{s.ciclo_promedio} d</td>
                      <td
                        style={{
                          textAlign: 'right',
                          color:
                            diffCiclo < 0
                              ? '#059669'
                              : diffCiclo > 0
                              ? '#dc2626'
                              : '#6b7280',
                        }}
                      >
                        {ant ? `${diffCiclo > 0 ? '↑' : diffCiclo < 0 ? '↓' : '→'} ${Math.abs(diffCiclo)} d` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {s.rendimiento_kg_por_unidad.toFixed(3)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="alert-box info">
          <strong>Próximamente:</strong> ciclos por mesada (para comparar entre
          mesadas y naves) y rendimiento por semilla.
        </div>
      </div>
    </>
  );
}
