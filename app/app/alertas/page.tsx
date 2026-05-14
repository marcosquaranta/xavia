import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Movimiento } from '@/lib/types';
import Header from '@/components/Header';
export const dynamic = 'force-dynamic';
export default async function AlertasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');
  let movimientos: Movimiento[] = [];
  try { movimientos = await readSheet<Movimiento>('Movimientos'); } catch {}
  const hoy = new Date();
  const cosechasConAlerta = movimientos.filter((m) => {
    if (m.tipo !== 'cosecha') return false;
    if (m.nivel_alerta !== 'amarillo' && m.nivel_alerta !== 'rojo') return false;
    try { const f = new Date(String(m.fecha)); return (hoy.getTime() - f.getTime()) / 86400000 <= 30; } catch { return true; }
  }).sort((a, b) => { if (a.nivel_alerta !== b.nivel_alerta) return a.nivel_alerta === 'rojo' ? -1 : 1; return String(b.fecha || '').localeCompare(String(a.fecha || '')); });
  const rojas = cosechasConAlerta.filter((m) => m.nivel_alerta === 'rojo').length;
  const amarillas = cosechasConAlerta.filter((m) => m.nivel_alerta === 'amarillo').length;
  const pendientes = cosechasConAlerta.filter((m) => !m.alerta_revisada || m.alerta_revisada === 'NO').length;
  const revisadas = cosechasConAlerta.filter((m) => m.alerta_revisada === 'SI').length;
  function fmt(f: string) { if (!f) return '-'; try { const [,m,d] = String(f).split('-'); return d+'/'+m; } catch { return f; } }
  return (
    <>
      <Header user={user} current="alertas" />
      <div className="container">
        <h1 className="page-title">Alertas y auditoría</h1>
        <p className="page-subtitle">Solo admin · Desvíos en cosechas · Últimos 30 días</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '20px' }}>
          {[[rojas, '#fee2e2', '#7f1d1d', 'Rojas'], [amarillas, '#fef3c7', '#78350f', 'Amarillas'], [pendientes, 'white', '#374151', 'Pendientes'], [revisadas, 'white', '#374151', 'Revisadas']].map(([n, bg, c, label]: any) => (
            <div key={label} style={{ background: bg, border: bg === 'white' ? '1px solid #e5e7eb' : 'none', borderRadius: '8px', padding: '12px' }}>
              <p style={{ margin: 0, fontSize: '10px', color: c, fontWeight: 600, textTransform: 'uppercase' }}>{label}</p>
              <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 600, color: c }}>{n}</p>
            </div>
          ))}
        </div>
        {cosechasConAlerta.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}><p style={{ margin: 0, color: '#9ca3af' }}>No hay alertas en los últimos 30 días.</p></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {cosechasConAlerta.map((m) => {
              const esRoja = m.nivel_alerta === 'rojo';
              const esRev = m.alerta_revisada === 'SI';
              return (
                <div key={m.id_movimiento} style={{ padding: '12px 14px', borderLeft: '3px solid', borderLeftColor: esRev ? '#9ca3af' : esRoja ? '#dc2626' : '#d97706', background: esRev ? '#f9fafb' : esRoja ? '#fef2f2' : '#fffbeb', display: 'flex', alignItems: 'flex-start', gap: '12px', borderTop: '1px solid #f3f4f6', opacity: esRev ? 0.7 : 1 }}>
                  <span style={{ background: esRev ? '#e5e7eb' : esRoja ? '#dc2626' : '#d97706', color: esRev ? '#6b7280' : 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500, minWidth: '52px', textAlign: 'center', flexShrink: 0 }}>+{Math.round(Number(m.desvio_porcentaje) || 0)}%</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>
                      Lote <Link href={'/cultivos/' + encodeURIComponent(m.id_lote)} className="lote-id" style={{ textDecoration: 'none' }}>{m.id_lote}</Link> · {fmt(String(m.fecha || ''))}
                      {esRev && <span style={{ color: '#059669', fontSize: '11px', marginLeft: '6px' }}>✓ Revisada</span>}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>{Number(m.unidades_cosechadas) || 0} unidades cosechadas · {Number(m.descarte_calculado) || 0} sin identificar{m.alerta_comentario ? <><br/><em>"{m.alerta_comentario}"</em></> : ''}</p>
                  </div>
                  {!esRev && <Link href={'/alertas/' + m.id_movimiento + '/revisar'} className="btn secondary small">Revisar</Link>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}