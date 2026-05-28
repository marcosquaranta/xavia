import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { tubosPorMesada } from '@/lib/ocupacion';
import { calcularCapacidadMensual } from '@/lib/capacidad';
import type { Lote, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
export const dynamic = 'force-dynamic';

export default async function OcupacionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let lotes: Lote[] = [], ubicaciones: Ubicacion[] = [];
  try {
    [lotes, ubicaciones] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Ubicacion>('Ubicaciones'),
    ]);
  } catch {}

  const tubosPorNave = tubosPorMesada(ubicaciones, lotes);
  const capacidad = calcularCapacidadMensual(ubicaciones, lotes);

  const tubosTotalGlobal = tubosPorNave.reduce((a: number, n: any) => a + n.tubos_totales, 0);
  const tubosOcupGlobal = tubosPorNave.reduce((a: number, n: any) => a + n.tubos_ocupados, 0);
  const ocPct = tubosTotalGlobal > 0 ? Math.round((tubosOcupGlobal / tubosTotalGlobal) * 100) : 0;

  function colorOc(pct: number) {
    return pct >= 75 ? '#059669' : pct >= 40 ? '#d97706' : '#9ca3af';
  }

  const totalLechugaMes = capacidad.reduce((a, n) => a + n.subtotal_lechuga.plantas_por_mes, 0);
  const totalRuculaMes = capacidad.reduce((a, n) => a + n.subtotal_rucula.plantas_por_mes, 0);

  return (
    <>
      <Header user={user} current="ocupacion" />
      <div className="container">
        <h1 className="page-title">Ocupación y capacidad</h1>
        <p className="page-subtitle">Tubos ocupados vs disponibles · Capacidad productiva mensual</p>

        {/* ===== SECCIÓN 1: OCUPACIÓN ACTUAL ===== */}
        <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px', color: '#374151' }}>
          Ocupación actual
        </h2>

        {/* Stats globales */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          {[
            ['Ocupación global', ocPct + '%', `${tubosOcupGlobal.toLocaleString('es-AR')} / ${tubosTotalGlobal.toLocaleString('es-AR')} tubos`],
            ['Tubos ocupados', tubosOcupGlobal.toLocaleString('es-AR'), 'en F1 y F2'],
            ['Tubos libres', (tubosTotalGlobal - tubosOcupGlobal).toLocaleString('es-AR'), 'disponibles'],
          ].map(([label, value, sub]: any) => (
            <div key={label} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px' }}>
              <p style={{ margin: 0, fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</p>
              <p style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 600 }}>{value}</p>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#9ca3af' }}>{sub}</p>
            </div>
          ))}
        </div>

        {/* Tabla de tubos por nave */}
        {tubosPorNave.map((nave: any) => (
          <div key={nave.nave} className="card" style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ background: nave.nave === 1 ? '#1e40af' : '#7c3aed', color: 'white', padding: '2px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 700 }}>
                  NAVE {nave.nave}
                </span>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {nave.tubos_ocupados.toLocaleString('es-AR')} / {nave.tubos_totales.toLocaleString('es-AR')} tubos · {nave.ocupacion_pct}%
                </span>
              </div>
              <div style={{ width: '100px', height: '5px', background: '#f3f4f6', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: Math.min(100, nave.ocupacion_pct) + '%', height: '100%', background: nave.nave === 1 ? '#1e40af' : '#7c3aed' }} />
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Mesada</th>
                  <th style={{ textAlign: 'center' }}>Fase</th>
                  <th style={{ textAlign: 'right' }}>Tubos totales</th>
                  <th style={{ textAlign: 'right' }}>Ocupados</th>
                  <th style={{ textAlign: 'right' }}>Libres</th>
                  <th style={{ textAlign: 'right' }}>Uso</th>
                  <th style={{ textAlign: 'right' }}>Lotes</th>
                </tr>
              </thead>
              <tbody>
                {nave.mesadas.map((m: any) => (
                  <tr key={m.id_ubicacion}>
                    <td style={{ fontWeight: 500, fontSize: '13px' }}>
                      {m.nombre.replace(/^Nave \d+ - /, '')}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        background: m.sector_fase === 'fase_1' ? '#dbeafe' : '#dcfce7',
                        color: m.sector_fase === 'fase_1' ? '#1e40af' : '#166534',
                        padding: '1px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                      }}>
                        {m.sector_fase === 'fase_1' ? 'F1' : 'F2'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{m.tubos_totales.toLocaleString('es-AR')}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{m.tubos_ocupados.toLocaleString('es-AR')}</td>
                    <td style={{ textAlign: 'right', color: m.tubos_libres > 0 ? '#059669' : '#9ca3af', fontWeight: 500 }}>
                      {m.tubos_libres.toLocaleString('es-AR')}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                        <div style={{ width: '50px', height: '4px', background: '#f3f4f6', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ width: Math.min(100, m.ocupacion_pct) + '%', height: '100%', background: colorOc(m.ocupacion_pct) }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: colorOc(m.ocupacion_pct), minWidth: '30px', textAlign: 'right' }}>
                          {m.ocupacion_pct}%
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', color: '#9ca3af', fontSize: '12px' }}>{m.lotes_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* ===== SECCIÓN 2: CAPACIDAD MENSUAL ===== */}
        <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '24px 0 12px', color: '#374151' }}>
          Capacidad productiva mensual
        </h2>
        <p style={{ fontSize: '12px', color: '#6b7280', margin: '-8px 0 14px' }}>
          Días de ciclo calculados desde los últimos lotes cosechados de cada mesada · F1 lechuga = buffer, no cosecha directo
        </p>

        {capacidad.map((nave) => (
          <div key={nave.nave} className="card" style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={{ background: nave.nave === 1 ? '#1e40af' : '#7c3aed', color: 'white', padding: '2px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 700 }}>
                NAVE {nave.nave}
              </span>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>
                {nave.total_plantas_por_mes.toLocaleString('es-AR')} plantas estimadas/mes
              </span>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Configuración</th>
                  <th style={{ textAlign: 'right' }}>Perfiles</th>
                  <th style={{ textAlign: 'right' }}>Orif/perf</th>
                  <th style={{ textAlign: 'right' }}>Posiciones</th>
                  <th style={{ textAlign: 'right' }}>Días ciclo</th>
                  <th style={{ textAlign: 'right' }}>Ciclos/mes</th>
                  <th style={{ textAlign: 'right' }}>Plantas/mes</th>
                </tr>
              </thead>
              <tbody>
                {nave.filas.map((f) => (
                  <tr key={f.id_ubicacion} style={{ opacity: f.es_f1 ? 0.5 : 1 }}>
                    <td style={{ fontWeight: 500 }}>
                      {f.nombre_corto}
                      {f.es_f1 && <span style={{ fontSize: '10px', color: '#9ca3af', marginLeft: '6px' }}>(buffer)</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{f.perfiles}</td>
                    <td style={{ textAlign: 'right' }}>{f.orif_por_perfil}</td>
                    <td style={{ textAlign: 'right' }}>{f.posiciones.toLocaleString('es-AR')}</td>
                    <td style={{ textAlign: 'right', color: f.es_f1 ? '#9ca3af' : '#374151' }}>
                      {f.es_f1 ? '—' : f.dias_ciclo + 'd'}
                    </td>
                    <td style={{ textAlign: 'right', color: f.es_f1 ? '#9ca3af' : '#374151' }}>
                      {f.es_f1 ? '—' : f.ciclos_por_mes.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: f.es_f1 ? 400 : 600, color: f.es_f1 ? '#9ca3af' : '#1f2937' }}>
                      {f.es_f1 ? '—' : f.plantas_por_mes.toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}

                {/* Subtotal Lechuga */}
                <tr style={{ background: '#f0fdf4', fontWeight: 600 }}>
                  <td colSpan={3} style={{ color: '#166534', fontSize: '12px' }}>N{nave.nave} — Subtotal LECHUGA (F2)</td>
                  <td style={{ textAlign: 'right', color: '#166534' }}>{nave.subtotal_lechuga.posiciones.toLocaleString('es-AR')}</td>
                  <td colSpan={2} />
                  <td style={{ textAlign: 'right', color: '#166534' }}>{nave.subtotal_lechuga.plantas_por_mes.toLocaleString('es-AR')}</td>
                </tr>

                {/* Subtotal Rúcula */}
                <tr style={{ background: '#f0fdf4', fontWeight: 600 }}>
                  <td colSpan={3} style={{ color: '#047857', fontSize: '12px' }}>N{nave.nave} — Subtotal RÚCULA</td>
                  <td style={{ textAlign: 'right', color: '#047857' }}>{nave.subtotal_rucula.posiciones.toLocaleString('es-AR')}</td>
                  <td colSpan={2} />
                  <td style={{ textAlign: 'right', color: '#047857' }}>{nave.subtotal_rucula.plantas_por_mes.toLocaleString('es-AR')}</td>
                </tr>

                {/* Total nave */}
                <tr style={{ background: '#dcfce7', fontWeight: 700 }}>
                  <td colSpan={6} style={{ color: '#14532d', fontSize: '13px' }}>TOTAL NAVE {nave.nave} (plantas/mes)</td>
                  <td style={{ textAlign: 'right', color: '#14532d', fontSize: '14px' }}>{nave.total_plantas_por_mes.toLocaleString('es-AR')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}

        {/* Totales globales */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginTop: '4px' }}>
          {[
            ['TOTAL LECHUGA (ambas naves)', totalLechugaMes.toLocaleString('es-AR'), 'plantas/mes', '#4d7c0f'],
            ['TOTAL RÚCULA (ambas naves)', totalRuculaMes.toLocaleString('es-AR'), 'plantas/mes', '#166534'],
            ['TOTAL GENERAL', (totalLechugaMes + totalRuculaMes).toLocaleString('es-AR'), 'plantas/mes', '#1e40af'],
          ].map(([label, value, sub, color]: any) => (
            <div key={label} style={{ background: 'white', border: `2px solid ${color}20`, borderRadius: '10px', padding: '14px' }}>
              <p style={{ margin: 0, fontSize: '10px', color, textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 600 }}>{label}</p>
              <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700, color }}>{value}</p>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#9ca3af' }}>{sub}</p>
            </div>
          ))}
        </div>

      </div>
    </>
  );
}
