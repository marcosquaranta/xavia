import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorNave, proyectarEntregas, ocupacionPlantineras, tubosPorMesada } from '@/lib/ocupacion';
import { diasPromedioPorVariedad, mapaDiasPromedio } from '@/lib/estadisticas';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
export const dynamic = 'force-dynamic';

export default async function OcupacionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [];
  try {
    [lotes, movimientos, ubicaciones] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones'),
    ]);
  } catch {}

  let naves: any[] = [], tiempos: any[] = [], entregas: any[] = [], plantineras: any[] = [], tubosPorNave: any[] = [];
  try {
    naves = ocupacionPorNave(ubicaciones, lotes);
    plantineras = ocupacionPlantineras(ubicaciones, lotes);
    tiempos = diasPromedioPorVariedad(lotes, movimientos, 60);
    const diasMap = mapaDiasPromedio(lotes, movimientos);
    entregas = proyectarEntregas(lotes, diasMap, 2);
    tubosPorNave = tubosPorMesada(ubicaciones, lotes);
  } catch {}

  const tubosTotalGlobal = tubosPorNave.reduce((a: number, n: any) => a + n.tubos_totales, 0);
  const tubosOcupGlobal = tubosPorNave.reduce((a: number, n: any) => a + n.tubos_ocupados, 0);
  const tubosLibresGlobal = tubosTotalGlobal - tubosOcupGlobal;
  const ocTubosGlobal = tubosTotalGlobal > 0 ? Math.round((tubosOcupGlobal / tubosTotalGlobal) * 100) : 0;

  function colorOc(pct: number) {
    return pct >= 80 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626';
  }

  function labelFase(f: string) {
    return f === 'fase_1' ? 'F1' : f === 'fase_2' ? 'F2' : f;
  }

  function labelVariedad(v: string) {
    if (v === 'lechuga') return 'Lechuga';
    if (v === 'rucula') return 'Rúcula';
    return v;
  }

  return (
    <>
      <Header user={user} current="ocupacion" />
      <div className="container">
        <h1 className="page-title">Ocupación e indicadores</h1>
        <p className="page-subtitle">Tubos ocupados vs disponibles · Por mesada y nave · F1 y F2</p>

        {/* Stats globales */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {[
            ['Ocupación global (tubos)', ocTubosGlobal + '%', tubosOcupGlobal.toLocaleString('es-AR') + ' de ' + tubosTotalGlobal.toLocaleString('es-AR')],
            ['Tubos ocupados', tubosOcupGlobal.toLocaleString('es-AR'), 'en mesadas F1 y F2'],
            ['Tubos libres', tubosLibresGlobal.toLocaleString('es-AR'), 'disponibles ahora'],
          ].map(([label, value, sub]: any) => (
            <div key={label} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</p>
              <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 600 }}>{value}</p>
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>{sub}</p>
            </div>
          ))}
        </div>

        {/* Tubos por nave y mesada */}
        {tubosPorNave.map((nave: any) => (
          <div key={nave.nave} className="card" style={{ marginBottom: '16px' }}>
            {/* Header nave */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ background: nave.nave === 1 ? '#1e40af' : '#7c3aed', color: 'white', padding: '3px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 700 }}>
                  NAVE {nave.nave}
                </span>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>
                  {nave.tubos_ocupados.toLocaleString('es-AR')} / {nave.tubos_totales.toLocaleString('es-AR')} tubos
                </span>
              </div>
              <span style={{ fontSize: '16px', fontWeight: 700, color: colorOc(nave.ocupacion_pct) }}>
                {nave.ocupacion_pct}%
              </span>
            </div>

            {/* Barra global de la nave */}
            <div style={{ height: '6px', background: '#f3f4f6', borderRadius: '4px', overflow: 'hidden', marginBottom: '16px' }}>
              <div style={{ width: Math.min(100, nave.ocupacion_pct) + '%', height: '100%', background: nave.nave === 1 ? '#1e40af' : '#7c3aed', borderRadius: '4px' }} />
            </div>

            {/* Tabla de mesadas */}
            <table>
              <thead>
                <tr>
                  <th>Mesada</th>
                  <th>Fase</th>
                  <th>Variedad</th>
                  <th style={{ textAlign: 'right' }}>Tubos totales</th>
                  <th style={{ textAlign: 'right' }}>Ocupados</th>
                  <th style={{ textAlign: 'right' }}>Libres</th>
                  <th style={{ textAlign: 'right' }}>Ocupación</th>
                  <th style={{ textAlign: 'right' }}>Lotes</th>
                </tr>
              </thead>
              <tbody>
                {nave.mesadas.map((m: any) => (
                  <tr key={m.id_ubicacion}>
                    <td style={{ fontWeight: 500 }}>{m.nombre.replace(/^Nave \d+ - /, '')}</td>
                    <td>
                      <span className={`pill ${m.sector_fase === 'fase_1' ? 'fase1' : 'fase2'}`} style={{ fontSize: '10px' }}>
                        {labelFase(m.sector_fase)}
                      </span>
                    </td>
                    <td style={{ color: m.variedad_asignada === 'lechuga' ? '#4d7c0f' : '#166534', fontWeight: 500, fontSize: '12px' }}>
                      {labelVariedad(m.variedad_asignada)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{m.tubos_totales}</td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>{m.tubos_ocupados}</td>
                    <td style={{ textAlign: 'right', color: m.tubos_libres > 0 ? '#059669' : '#9ca3af', fontWeight: 500 }}>
                      {m.tubos_libres}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                        <div style={{ width: '60px', height: '5px', background: '#f3f4f6', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: Math.min(100, m.ocupacion_pct) + '%', height: '100%', background: colorOc(m.ocupacion_pct), borderRadius: '3px' }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: colorOc(m.ocupacion_pct), minWidth: '32px', textAlign: 'right' }}>
                          {m.ocupacion_pct}%
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', color: '#6b7280', fontSize: '12px' }}>{m.lotes_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* Plantineras */}
        {plantineras.length > 0 && (
          <div className="card">
            <p className="card-title">Plantineras</p>
            <p className="card-sub">Capacidad de bandejas · No incluida en ocupación de mesadas</p>
            {plantineras.map((p: any) => {
              const color = p.ocupacion_pct >= 85 ? '#d97706' : p.ocupacion_pct >= 50 ? '#059669' : '#9ca3af';
              return (
                <div key={p.nombre} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 500 }}>{p.nombre}</span>
                    <span style={{ color: '#6b7280' }}>
                      <strong style={{ color: '#1f2937' }}>{p.plantines.toLocaleString('es-AR')}</strong>
                      {' / '}{p.capacidad.toLocaleString('es-AR')} plantines
                      {' · '}<span style={{ color }}>{p.ocupacion_pct}%</span>
                      {p.libres > 0 && <span style={{ color: '#059669' }}> · {p.libres.toLocaleString('es-AR')} libres</span>}
                    </span>
                  </div>
                  <div style={{ height: '7px', background: '#f3f4f6', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: Math.min(100, p.ocupacion_pct) + '%', height: '100%', background: color, borderRadius: '4px' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Proyección entregas */}
        {entregas.length > 0 && (
          <div className="card">
            <p className="card-title">Proyección de entregas</p>
            <p className="card-sub">Basado en ciclos estimados de lotes activos.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
              {entregas.map((e: any, i: number) => (
                <div key={i} style={{ background: i < 2 ? '#dbeafe' : '#f9fafb', borderRadius: '8px', padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '10px', color: i < 2 ? '#1e40af' : '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>
                    {e.diaSemana.charAt(0).toUpperCase() + e.diaSemana.slice(1)} · {e.fecha}
                  </p>
                  <p style={{ margin: '0 0 6px', fontSize: i < 2 ? '18px' : '16px', fontWeight: 600, color: i < 2 ? '#1e40af' : '#374151' }}>
                    {e.total_plantas.toLocaleString('es-AR')} plantas
                  </p>
                  <div style={{ fontSize: '11px', color: i < 2 ? '#1e40af' : '#6b7280', lineHeight: 1.6 }}>
                    {e.lechuga_crespa > 0 && <div>L. Crespa: {e.lechuga_crespa}</div>}
                    {e.lechuga_roble > 0 && <div>H. Roble: {e.lechuga_roble}</div>}
                    {e.rucula_plantas > 0 && <div>Rúcula: {e.rucula_plantas} (~{e.rucula_paquetes_aprox} paq)</div>}
                    {e.albahaca_plantas > 0 && <div>Albahaca: {e.albahaca_plantas} (~{e.albahaca_paquetes_aprox} paq)</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tiempos promedio */}
        {tiempos.length > 0 && (
          <div className="card">
            <p className="card-title">Tiempos promedio por fase (últimos 60 días)</p>
            <table>
              <thead>
                <tr>
                  <th>Variedad</th>
                  <th style={{ textAlign: 'right' }}>Plantinera</th>
                  <th style={{ textAlign: 'right' }}>F1</th>
                  <th style={{ textAlign: 'right' }}>F2</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Lotes</th>
                </tr>
              </thead>
              <tbody>
                {tiempos.map((t: any) => (
                  <tr key={t.variedad}>
                    <td>{t.variedad}</td>
                    <td style={{ textAlign: 'right' }}>{t.plantinera}d</td>
                    <td style={{ textAlign: 'right', color: t.fase_1 === null ? '#9ca3af' : 'inherit' }}>{t.fase_1 === null ? '—' : t.fase_1 + 'd'}</td>
                    <td style={{ textAlign: 'right' }}>{t.fase_2}d</td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>{t.total}d</td>
                    <td style={{ textAlign: 'right', color: '#6b7280' }}>{t.lotes_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
