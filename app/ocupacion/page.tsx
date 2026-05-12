import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorMesada, ocupacionPorNave, proyectarEntregas, nivelOcupacion } from '@/lib/ocupacion';
import { diasPromedioPorVariedad, mapaDiasPromedio } from '@/lib/estadisticas';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
export const dynamic = 'force-dynamic';
export default async function OcupacionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [];
  try { [lotes, movimientos, ubicaciones] = await Promise.all([readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones')]); } catch {}
  let mesadas: any[] = [], naves: any[] = [], tiempos: any[] = [], entregas: any[] = [];
  try { mesadas = ocupacionPorMesada(ubicaciones, lotes); naves = ocupacionPorNave(ubicaciones, lotes); tiempos = diasPromedioPorVariedad(lotes, movimientos, 60); const diasMap = mapaDiasPromedio(lotes, movimientos); entregas = proyectarEntregas(lotes, diasMap, 2); } catch {}
  const capTotal = naves.reduce((a: number, n: any) => a + n.capacidad_total, 0);
  const plantasTot = naves.reduce((a: number, n: any) => a + n.plantas_vivas, 0);
  const ocGlobal = capTotal > 0 ? Math.round((plantasTot / capTotal) * 100) : 0;
  return (
    <>
      <Header user={user} current="ocupacion" />
      <div className="container">
        <h1 className="page-title">Ocupación e indicadores</h1>
        <p className="page-subtitle">Ocupación de mesadas (F1 y F2) · Plantineras excluidas · Capacidad instalada: {capTotal.toLocaleString('es-AR')} posiciones</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {[
            ['Ocupación global', ocGlobal + '%', plantasTot.toLocaleString('es-AR') + ' de ' + capTotal.toLocaleString('es-AR')],
            ['Plantas en mesadas', plantasTot.toLocaleString('es-AR'), 'F1 y F2 · excluye plantineras'],
            ['Tubos libres', naves.reduce((a: number, n: any) => a + (n.tubos_libres || 0), 0).toLocaleString('es-AR'), 'disponibles en mesadas'],
          ].map(([label, value, sub]: any) => (
            <div key={label} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</p>
              <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 600 }}>{value}</p>
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>{sub}</p>
            </div>
          ))}
        </div>
        <div className="card">
          <p className="card-title">Densidad por nave</p>
          <table>
            <thead><tr><th>Nave</th><th style={{ textAlign: 'right' }}>m²</th><th style={{ textAlign: 'right' }}>Capacidad</th><th style={{ textAlign: 'right' }}>Plantas vivas</th><th style={{ textAlign: 'right' }}>Densidad actual</th><th style={{ textAlign: 'right' }}>Densidad máx.</th><th style={{ textAlign: 'right' }}>Ocupación</th></tr></thead>
            <tbody>
              {naves.map((n: any) => (
                <tr key={n.nave}>
                  <td>Nave {n.nave}</td><td style={{ textAlign: 'right' }}>{n.metros_cuadrados}</td>
                  <td style={{ textAlign: 'right' }}>{n.capacidad_total.toLocaleString('es-AR')}</td>
                  <td style={{ textAlign: 'right' }}>{n.plantas_vivas.toLocaleString('es-AR')}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{n.densidad_actual} pl/m²</td>
                  <td style={{ textAlign: 'right' }}>{n.densidad_maxima} pl/m²</td>
                  <td style={{ textAlign: 'right', fontWeight: 500, color: n.ocupacion_pct >= 70 ? '#059669' : n.ocupacion_pct >= 40 ? '#d97706' : '#dc2626' }}>{n.ocupacion_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entregas.length > 0 && (
          <div className="card">
            <p className="card-title">Proyección de entregas</p>
            <p className="card-sub">Todo en plantas (rúcula con paquetes de referencia).</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
              {entregas.map((e: any, i: number) => (
                <div key={i} style={{ background: i < 2 ? '#dbeafe' : '#f9fafb', borderRadius: '8px', padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '10px', color: i < 2 ? '#1e40af' : '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>{e.diaSemana.charAt(0).toUpperCase() + e.diaSemana.slice(1)} · {e.fecha}</p>
                  <p style={{ margin: '0 0 6px', fontSize: i < 2 ? '18px' : '16px', fontWeight: 600, color: i < 2 ? '#1e40af' : '#374151' }}>{e.total_plantas.toLocaleString('es-AR')} plantas</p>
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
        <div className="card">
          <p className="card-title">Ocupación por mesada</p>
          {mesadas.map((m: any) => {
            const nivel = nivelOcupacion(m.ocupacion_pct);
            return (
              <div key={m.id_ubicacion} style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 500 }}>{m.nombre}</span>
                  <span style={{ color: '#6b7280' }}>{m.plantas_vivas.toLocaleString('es-AR')} / {m.capacidad.toLocaleString('es-AR')} · <span style={{ fontWeight: 500, color: nivel === 'ok' ? '#059669' : nivel === 'warn' ? '#d97706' : '#dc2626' }}>{m.ocupacion_pct}%</span></span>
                </div>
                <div style={{ height: '7px', background: '#f3f4f6', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: Math.min(100, m.ocupacion_pct) + '%', height: '100%', background: nivel === 'ok' ? '#10b981' : nivel === 'warn' ? '#d97706' : '#dc2626' }} />
                </div>
              </div>
            );
          })}
        </div>
        {tiempos.length > 0 && (
          <div className="card">
            <p className="card-title">Tiempos promedio por fase (últimos 60 días)</p>
            <table>
              <thead><tr><th>Variedad</th><th style={{ textAlign: 'right' }}>Plantinera</th><th style={{ textAlign: 'right' }}>F1</th><th style={{ textAlign: 'right' }}>F2</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Lotes</th></tr></thead>
              <tbody>
                {tiempos.map((t: any) => (
                  <tr key={t.variedad}>
                    <td>{t.variedad}</td><td style={{ textAlign: 'right' }}>{t.plantinera}d</td>
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