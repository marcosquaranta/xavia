import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularDiasPorFase } from '@/lib/lotes';
import { tubosPorMesada } from '@/lib/ocupacion';
import { diasPromedioPorVariedad } from '@/lib/estadisticas';
import type { Movimiento, Lote, Ubicacion, Variedad } from '@/lib/types';
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

  let movimientos: Movimiento[] = [], lotes: Lote[] = [], ubicaciones: Ubicacion[] = [], variedades: Variedad[] = [];
  try {
    [movimientos, lotes, ubicaciones, variedades] = await Promise.all([
      readSheet<Movimiento>('Movimientos'), readSheet<Lote>('Lotes'),
      readSheet<Ubicacion>('Ubicaciones'), readSheet<Variedad>('Variedades'),
    ]);
  } catch {}

  const hoy = new Date();
  const dow = hoy.getDay(); // 5 = viernes, 6 = sábado
  const esControlStock = dow === 5 || dow === 6;

  const variedadMap = new Map(variedades.map(v => [v.variedad, v]));
  const estMap = new Map(diasPromedioPorVariedad(lotes, movimientos, 120).map(d => [d.variedad, d]));
  const activos = lotes.filter(l => l.estado === 'activo');

  // ── 1) Tubos vacíos ──
  const navesTubos = tubosPorMesada(ubicaciones, lotes);
  const mesadasLibres = navesTubos.flatMap(n =>
    n.mesadas.filter(m => m.sector_fase !== 'fase_1' && m.tubos_libres > 0)
      .map(m => ({ nombre: m.nombre, nave: m.nave, libres: m.tubos_libres, totales: m.tubos_totales }))
  ).sort((a, b) => b.libres - a.libres);

  // ── 2) Próximos trasplantes (plantinera→F1, F1→F2) ──
  // ── 3) Próximas cosechas (F2) ──
  const proxTrasplante: { id: string; variedad: string; a: string; dias: number; est: number; faltan: number; nave: number }[] = [];
  const proxCosecha: { id: string; variedad: string; dias: number; est: number; faltan: number; ubic: string }[] = [];
  const naveDe = (ubic: string) => /nave\s*2/i.test(String(ubic)) ? 2 : 1;
  for (const l of activos) {
    let dias: any;
    try { dias = calcularDiasPorFase(l, movimientos); } catch { continue; }
    const v = variedadMap.get(l.variedad);
    const est = estMap.get(l.variedad);
    if (l.fase_actual === 'plantin') {
      const e = est?.plantinera || 10;
      const faltan = e - dias.plantinera;
      if (faltan <= 3) proxTrasplante.push({ id: l.id_lote, variedad: l.variedad, a: 'Fase 1', dias: dias.plantinera, est: e, faltan, nave: naveDe(l.ubicacion_actual) });
    } else if (l.fase_actual === 'fase_1') {
      const e = est?.fase_1 || 22;
      const faltan = e - (dias.fase_1 || 0);
      if (faltan <= 3) proxTrasplante.push({ id: l.id_lote, variedad: l.variedad, a: 'Fase 2', dias: dias.fase_1 || 0, est: e, faltan, nave: naveDe(l.ubicacion_actual) });
    } else if (l.fase_actual === 'fase_2') {
      const e = Number(v?.dias_estimados_cosecha) || est?.total || 40;
      const faltan = e - dias.total;
      if (faltan <= 4) proxCosecha.push({ id: l.id_lote, variedad: l.variedad, dias: dias.total, est: e, faltan, ubic: l.ubicacion_actual });
    }
  }
  proxTrasplante.sort((a, b) => a.faltan - b.faltan);
  proxCosecha.sort((a, b) => a.faltan - b.faltan);

  // ── 4) Otras alertas: desvíos de cosecha ──
  const cosechasConAlerta = movimientos.filter((m) => {
    if (m.tipo !== 'cosecha') return false;
    if (m.nivel_alerta !== 'amarillo' && m.nivel_alerta !== 'rojo') return false;
    try { const f = new Date(String(m.fecha)); return (hoy.getTime() - f.getTime()) / 86400000 <= 30; } catch { return true; }
  }).sort((a, b) => { if (a.nivel_alerta !== b.nivel_alerta) return a.nivel_alerta === 'rojo' ? -1 : 1; return String(b.fecha || '').localeCompare(String(a.fecha || '')); });

  const faltanLabel = (n: number) => n < 0 ? `atrasado ${-n} d` : n === 0 ? 'hoy' : `en ${n} d`;
  const faltanColor = (n: number) => n < 0 ? '#dc2626' : n === 0 ? '#d97706' : '#059669';

  return (
    <>
      <Header user={user} current="alertas" />
      <div className="container">
        <h1 className="page-title">Alertas</h1>
        <p className="page-subtitle">Tareas y avisos del día · Solo admin</p>

        {/* Control de stock viernes/sábado */}
        {esControlStock && (
          <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>📋</span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1e40af' }}>Hacer control de stock de rúculas y lechugas</span>
          </div>
        )}

        {/* 1) Tubos vacíos */}
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

        {/* 2) Próximos trasplantes */}
        <div style={card}>
          <p style={titulo}>🔁 Próximos trasplantes <span style={{ fontWeight: 400, fontSize: '12px', color: '#9ca3af' }}>({proxTrasplante.length})</span></p>
          {proxTrasplante.length === 0 ? <p style={vacio}>Nada para trasplantar en los próximos días.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {proxTrasplante.map(t => (
                <Link key={t.id} href={'/cultivos/' + encodeURIComponent(t.id)} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '7px', padding: '8px 12px' }}>
                  <span style={{ fontSize: '13px' }}>
                    <span style={{ background: t.nave === 1 ? '#881337' : '#7c3aed', color: 'white', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 700, marginRight: '6px' }}>N{t.nave}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{t.id}</span>
                    <span style={{ color: '#6b7280', marginLeft: '6px' }}>→ {t.a}</span>
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: faltanColor(t.faltan) }}>{faltanLabel(t.faltan)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* 3) Próximas cosechas */}
        <div style={card}>
          <p style={titulo}>🌾 Próximas cosechas <span style={{ fontWeight: 400, fontSize: '12px', color: '#9ca3af' }}>({proxCosecha.length})</span></p>
          {proxCosecha.length === 0 ? <p style={vacio}>Nada para cosechar en los próximos días.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {proxCosecha.map(c => (
                <Link key={c.id} href={'/cultivos/' + encodeURIComponent(c.id)} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '7px', padding: '8px 12px' }}>
                  <span style={{ fontSize: '13px' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.id}</span>
                    <span style={{ color: '#6b7280', marginLeft: '6px' }}>{String(c.variedad).split(' ').slice(0, 2).join(' ')}</span>
                    <span style={{ color: '#9ca3af', marginLeft: '6px', fontSize: '11px' }}>{mesadaCorta(c.ubic)}</span>
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: faltanColor(c.faltan) }}>{faltanLabel(c.faltan)} <span style={{ color: '#9ca3af', fontWeight: 400 }}>({c.dias}/{c.est}d)</span></span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* 4) Otras alertas: desvíos de cosecha */}
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
