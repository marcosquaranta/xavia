// app/estadisticas/page.tsx
// Estadísticas con gráfico de evolución anual y comparaciones mensuales.
// El selector de variedad usa un link/form con submit normal (sin onChange en server).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { estadisticasDelMes, ciclosPorMesYAnio } from '@/lib/estadisticas';
import type { Lote, Movimiento, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import GraficoEvolucion from './GraficoEvolucion';
import SelectorVariedad from './SelectorVariedad';

export const dynamic = 'force-dynamic';

export default async function EstadisticasPage({
  searchParams,
}: {
  searchParams: { variedad?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let lotes: Lote[] = [];
  let movimientos: Movimiento[] = [];
  let variedades: Variedad[] = [];
  let errorLectura: string | null = null;

  try {
    [lotes, movimientos, variedades] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Movimiento>('Movimientos'),
      readSheet<Variedad>('Variedades'),
    ]);
  } catch (err: any) {
    errorLectura = err?.message || 'Error al leer datos';
  }

  if (errorLectura) {
    return (
      <>
        <Header user={user} current="estadisticas" />
        <div className="container">
          <div className="alert-box error">{errorLectura}</div>
        </div>
      </>
    );
  }

  const hoy = new Date();
  const mesPasado = new Date(hoy);
  mesPasado.setMonth(mesPasado.getMonth() - 1);

  const variedadesActivas = variedades.filter((v) => v.activo === 'SI');
  const variedadSeleccionada =
    searchParams.variedad ||
    variedadesActivas[0]?.variedad ||
    'Lechuga Crespa';

  // Calcular stats con tolerancia a errores
  let statsMesActual: any[] = [];
  let statsMesPasado: any[] = [];
  let datosActual: [number, number][] = [];
  let datosAnterior: [number, number][] = [];

  try {
    statsMesActual = estadisticasDelMes(lotes, movimientos, hoy);
    statsMesPasado = estadisticasDelMes(lotes, movimientos, mesPasado);
  } catch { /* ignore */ }

  try {
    const anioActual = hoy.getFullYear();
    const anioAnterior = anioActual - 1;
    const ciclosActual = ciclosPorMesYAnio(lotes, movimientos, anioActual);
    const ciclosAnterior = ciclosPorMesYAnio(lotes, movimientos, anioAnterior);
    const mapActual = ciclosActual.get(variedadSeleccionada) || new Map<number, number>();
    const mapAnterior = ciclosAnterior.get(variedadSeleccionada) || new Map<number, number>();
    // Convertir a arrays de pares [mes, dias] — son serializables (no Maps)
    datosActual = Array.from(mapActual.entries()).filter(([k]) => k < 12) as [number, number][];
    datosAnterior = Array.from(mapAnterior.entries()).filter(([k]) => k < 12) as [number, number][];
  } catch { /* ignore */ }

  const anioActual = hoy.getFullYear();
  const anioAnterior = anioActual - 1;
  const nombreMes = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container">
        <h1 className="page-title">Estadísticas</h1>
        <p className="page-subtitle">
          Vista agregada · {nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}
        </p>

        {/* Gráfico de evolución */}
        <div className="card">
          <p className="card-title">
            Evolución de ciclos · {anioActual} vs {anioAnterior}
          </p>
          <p className="card-sub">
            Días promedio de ciclo total por mes. Línea sólida = {anioActual}, punteada = {anioAnterior}.
          </p>

          {/* Selector de variedad — componente cliente para manejar el submit */}
          <SelectorVariedad
            variedades={variedadesActivas.map((v) => v.variedad)}
            seleccionada={variedadSeleccionada}
          />

          <GraficoEvolucion
            datosActual={datosActual}
            datosAnterior={datosAnterior}
            anioActual={anioActual}
            anioAnterior={anioAnterior}
          />
        </div>

        {/* Tabla mes actual vs anterior */}
        <div className="card">
          <p className="card-title">Ciclo y producción por variedad — mes actual vs anterior</p>
          {statsMesActual.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
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
                  const ant = statsMesPasado.find((x: any) => x.variedad === s.variedad);
                  const diffCosechado = ant
                    ? Math.round(((s.cosechado - ant.cosechado) / Math.max(1, ant.cosechado)) * 100)
                    : 0;
                  const diffCiclo = ant ? s.ciclo_promedio - ant.ciclo_promedio : 0;
                  return (
                    <tr key={s.variedad}>
                      <td>{s.variedad}</td>
                      <td style={{ textAlign: 'right' }}>{s.cosechado.toLocaleString('es-AR')}</td>
                      <td style={{ textAlign: 'right', color: diffCosechado > 0 ? '#059669' : diffCosechado < 0 ? '#dc2626' : '#6b7280' }}>
                        {ant ? `${diffCosechado >= 0 ? '↑' : '↓'} ${Math.abs(diffCosechado)}%` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{s.ciclo_promedio} d</td>
                      <td style={{ textAlign: 'right', color: diffCiclo < 0 ? '#059669' : diffCiclo > 0 ? '#dc2626' : '#6b7280' }}>
                        {ant ? `${diffCiclo > 0 ? '↑' : diffCiclo < 0 ? '↓' : '→'} ${Math.abs(diffCiclo)} d` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {typeof s.rendimiento_kg_por_unidad === 'number'
                          ? s.rendimiento_kg_por_unidad.toFixed(3)
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="alert-box info">
          <strong>Próximamente:</strong> ciclos por mesada y rendimiento por semilla.
        </div>
      </div>
    </>
  );
}
