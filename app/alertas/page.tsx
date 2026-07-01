import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { tubosPorMesada } from '@/lib/ocupacion';
import type { Movimiento, Lote, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

const card: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', marginBottom: '16px' };
const titulo: React.CSSProperties = { margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' };
const vacio: React.CSSProperties = { fontSize: '13px', color: '#9ca3af', fontStyle: 'italic' };

function fmtCorta(f: string) { if (!f) return '-'; try { const [, m, d] = String(f).split('-'); return d + '/' + m; } catch { return f; } }
const mesadaCorta = (s: string) => String(s).replace(/^Nave \d+ - /, '');

export default async function AlertasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let movimientos: Movimiento[] = [], lotes: Lote[] = [], ubicaciones: Ubicacion[] = [];
  try {
    [movimientos, lotes, ubicaciones] = await Promise.all([
      readSheet<Movimiento>('Movimientos'), readSheet<Lote>('Lotes'), readSheet<Ubicacion>('Ubicaciones'),
    ]);
  } catch {}

  const hoy = new Date();

  // ── Tubos vacíos (ocupación) ──
  const navesTubos = tubosPorMesada(ubicaciones, lotes);
  const mesadasLibres = navesTubos.flatMap(n =>
    n.mesadas.filter(m => m.sector_fase !== 'fase_1' && m.tubos_libres > 0)
      .map(m => ({ nombre: m.nombre, nave: m.nave, libres: m.tubos_libres, totales: m.tubos_totales }))
  ).sort((a, b) => b.libres - a.libres);

  // ── Otras alertas: desvíos de cosecha (alertas de sistema) ──
  const cosechasConAlerta = movimientos.filter((m) => {
    if (m.tipo !== 'cosecha') return false;
    if (m.nivel_alerta !== 'amarillo' && m.nivel_alerta !== 'rojo') return false;
    try { const f = new Date(String(m.fecha)); return (hoy.getTime() - f.getTime()) / 86400000 <= 30; } catch { return true; }
  }).sort((a, b) => { if (a.nivel_alerta !== b.nivel_alerta) return a.nivel_alerta === 'rojo' ? -1 : 1; return String(b.fecha || '').localeCompare(String(a.fecha || '')); });

  return (
    <>
      <Header user={user} current="alertas" />
      <div className="container">
        <h1 className="page-title">Alertas</h1>
        <p className="page-subtitle">Ocupación y avisos del sistema · Solo admin. Las tareas del día (cosecha, trasplantes, siembra) están en <Link href="/planificacion">Planificación → Tareas de hoy</Link>.</p>

        {/* Tubos vacíos */}
        <div style={card}>
          <p style={titulo}>🕳️ Tubos vacíos <span style={{ fontWeight: 400, fontSize: '12px', color: '#9ca3af' }}>({mesadasLibres.reduce((a, m) => a + m.libres, 0)} libres)</span></p>
          {mesadasLibres.length === 0 ? <p style={vacio}>Todas las mesadas están llenas.</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
              {mesadasLibres.map(m => (
                <div key={m.nombre} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '7px', padding: '8px 10px' }}>
                  <span style={{ fontSize: '13px' }}>
                    <span style={{ background: m.nave === 1 ? '#881337' : '#7c3aed', color: 'white', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 700, marginRight: '6px' }}>N{m.nave}</span>
                    {mesadaCorta(m.nombre)}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#059669' }}>{m.libres}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Otras alertas: desvíos de cosecha */}
        <div style={card}>
          <p style={titulo}>⚠️ Otras alertas <span style={{ fontWeight: 400, fontSize: '12px', color: '#9ca3af' }}>· desvíos de cosecha (30 días)</span></p>
          {cosechasConAlerta.length === 0 ? <p style={vacio}>Sin desvíos en cosechas.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {cosechasConAlerta.map((m) => {
                const esRoja = m.nivel_alerta === 'rojo';
                const esRev = m.alerta_revisada === 'SI';
                return (
                  <div key={m.id_movimiento} style={{ padding: '10px 12px', borderLeft: '3px solid', borderLeftColor: esRev ? '#9ca3af' : esRoja ? '#dc2626' : '#d97706', background: esRev ? '#f9fafb' : esRoja ? '#fef2f2' : '#fffbeb', display: 'flex', alignItems: 'flex-start', gap: '10px', borderTop: '1px solid #f3f4f6', borderRadius: '6px', marginBottom: '6px', opacity: esRev ? 0.7 : 1 }}>
                    <span style={{ background: esRev ? '#e5e7eb' : esRoja ? '#dc2626' : '#d97706', color: esRev ? '#6b7280' : 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500, minWidth: '52px', textAlign: 'center', flexShrink: 0 }}>+{Math.round(Number(m.desvio_porcentaje) || 0)}%</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>
                        Lote <Link href={'/cultivos/' + encodeURIComponent(m.id_lote)} className="lote-id" style={{ textDecoration: 'none' }}>{m.id_lote}</Link> · {fmtCorta(String(m.fecha || ''))}
                        {esRev && <span style={{ color: '#059669', fontSize: '11px', marginLeft: '6px' }}>✓ Revisada</span>}
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>{Number(m.unidades_cosechadas) || 0} unidades · {Number(m.descarte_calculado) || 0} sin identificar{m.alerta_comentario ? <><br /><em>"{m.alerta_comentario}"</em></> : ''}</p>
                    </div>
                    {!esRev && <Link href={'/alertas/' + m.id_movimiento + '/revisar'} className="btn secondary small">Revisar</Link>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
