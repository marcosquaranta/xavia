import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Movimiento, Lote } from '@/lib/types';
import Header from '@/components/Header';
import Link from 'next/link';
export const dynamic = 'force-dynamic';

const TIPO_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  siembra:    { label: 'Siembra',    color: '#92400e', bg: '#fef9c3' },
  trasplante: { label: 'Trasplante', color: '#1e40af', bg: '#dbeafe' },
  cosecha:    { label: 'Cosecha',    color: '#166534', bg: '#dcfce7' },
  descarte:   { label: 'Descarte',   color: '#6b7280', bg: '#f3f4f6' },
  division:   { label: 'División',   color: '#7c3aed', bg: '#ede9fe' },
};

function fmtFecha(s: any) {
  const str = String(s || '').split(/[\sT]/)[0];
  if (!str || str === 'undefined') return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function diasAtras(s: any): string {
  try {
    const str = String(s || '').split(/[\sT]/)[0];
    if (!str) return '';
    const diff = Math.round((Date.now() - new Date(str + 'T12:00:00').getTime()) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    return `Hace ${diff}d`;
  } catch { return ''; }
}

export default async function MovimientosPage({
  searchParams
}: { searchParams: { tipo?: string; dias?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let movimientos: Movimiento[] = [], lotes: Lote[] = [];
  try {
    [movimientos, lotes] = await Promise.all([
      readSheet<Movimiento>('Movimientos'),
      readSheet<Lote>('Lotes'),
    ]);
  } catch {}

  const tipoFiltro = searchParams.tipo || 'todos';
  const diasFiltro = Number(searchParams.dias || 7);

  // Filtrar por días
  const limite = new Date();
  limite.setDate(limite.getDate() - diasFiltro);

  const movsFiltrados = movimientos
    .filter(m => {
      const f = String(m.fecha || '').split(/[\sT]/)[0];
      if (!f) return false;
      try { if (new Date(f + 'T12:00:00') < limite) return false; } catch { return false; }
      if (tipoFiltro !== 'todos' && m.tipo !== tipoFiltro) return false;
      return true;
    })
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  // Enriquecer con datos del lote
  const lotesMap = new Map(lotes.map(l => [l.id_lote, l]));

  // Agrupar por fecha
  const porFecha = new Map<string, typeof movsFiltrados>();
  for (const m of movsFiltrados) {
    const f = String(m.fecha || '').split(/[\sT]/)[0] || 'sin fecha';
    if (!porFecha.has(f)) porFecha.set(f, []);
    porFecha.get(f)!.push(m);
  }

  const fechasOrdenadas = [...porFecha.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <>
      <Header user={user} current="movimientos" />
      <div className="container">
        <h1 className="page-title">Últimos movimientos</h1>
        <p className="page-subtitle">Registro de actividad — siembras, trasplantes y cosechas</p>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase' }}>Período</span>
          {[
            { dias: 1, label: 'Hoy' },
            { dias: 3, label: 'Últimos 3d' },
            { dias: 7, label: 'Última semana' },
            { dias: 30, label: 'Último mes' },
          ].map(({ dias, label }) => (
            <Link key={dias} href={`/movimientos?tipo=${tipoFiltro}&dias=${dias}`} style={{ textDecoration: 'none' }}>
              <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: diasFiltro === dias ? 700 : 400, background: diasFiltro === dias ? '#111827' : '#f3f4f6', color: diasFiltro === dias ? 'white' : '#374151', cursor: 'pointer' }}>{label}</span>
            </Link>
          ))}
          <span style={{ width: '1px', height: '20px', background: '#e5e7eb', display: 'inline-block' }} />
          <span style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase' }}>Tipo</span>
          {['todos', 'siembra', 'trasplante', 'cosecha', 'division'].map(t => (
            <Link key={t} href={`/movimientos?tipo=${t}&dias=${diasFiltro}`} style={{ textDecoration: 'none' }}>
              <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: tipoFiltro === t ? 700 : 400, background: tipoFiltro === t ? (TIPO_LABEL[t]?.bg || '#111827') : '#f3f4f6', color: tipoFiltro === t ? (TIPO_LABEL[t]?.color || 'white') : '#374151', border: tipoFiltro === t ? `1px solid ${TIPO_LABEL[t]?.color || '#111'}` : '1px solid transparent', cursor: 'pointer' }}>
                {t === 'todos' ? 'Todos' : TIPO_LABEL[t]?.label}
              </span>
            </Link>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#9ca3af' }}>{movsFiltrados.length} movimientos</span>
        </div>

        {movsFiltrados.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
            Sin movimientos en este período.
          </div>
        ) : (
          fechasOrdenadas.map(fecha => {
            const movs = porFecha.get(fecha)!;
            return (
              <div key={fecha} style={{ marginBottom: '20px' }}>
                {/* Header de fecha */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>{fmtFecha(fecha)}</span>
                  <span style={{ fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }}>{diasAtras(fecha)}</span>
                  <span style={{ flex: 1, height: '1px', background: '#f3f4f6' }} />
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>{movs.length} mov.</span>
                </div>

                {/* Lista de movimientos del día */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {movs.map(m => {
                    const lote = lotesMap.get(String(m.id_lote || ''));
                    const t = TIPO_LABEL[String(m.tipo || '')] || TIPO_LABEL.descarte;
                    const varNorm = String(lote?.variedad || '').toLowerCase();
                    const esRucula = varNorm.includes('rucula') || varNorm.includes('rúcula');
                    const colorVar = esRucula ? '#166534' : '#4d7c0f';
                    // Cosecha: la cantidad real cosechada va en unidades_cosechadas, NO en
                    // plantas_estimadas (esa es la estimación de siembra/trasplante — para
                    // cosecha queda vieja/desactualizada). Mismo criterio que ya usa el Panel.
                    const cantCosechado = Number(m.unidades_cosechadas || 0);
                    const cantEstimado = Number(m.plantas_estimadas || 0);
                    const unidades = m.tipo === 'cosecha' && esRucula && cantCosechado > 0
                      ? `${cantCosechado.toLocaleString('es-AR')} paq. (${cantEstimado.toLocaleString('es-AR')} pl)`
                      : m.tipo === 'cosecha' && cantCosechado > 0
                        ? `${cantCosechado.toLocaleString('es-AR')} pl`
                        : m.tipo === 'division' && cantEstimado > 0
                          ? `${cantEstimado.toLocaleString('es-AR')} quedan`
                          : cantEstimado > 0 ? `${cantEstimado.toLocaleString('es-AR')} pl` : '';
                    const usuario = String(m.usuario || '').split('@')[0] || '—';

                    return (
                      <Link key={m.id_movimiento} href={`/cultivos/${encodeURIComponent(String(m.id_lote || ''))}`}
                        style={{ textDecoration: 'none', color: 'inherit', background: 'white', border: '1px solid #f3f4f6', borderLeft: `4px solid ${t.color}`, borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', cursor: 'pointer' }}>
                        {/* Badge tipo */}
                        <span style={{ background: t.bg, color: t.color, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, minWidth: '80px', textAlign: 'center' }}>
                          {t.label}
                        </span>

                        {/* Lote + variedad */}
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '13px', color: '#1d4ed8', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{m.id_lote}</span>
                          {lote?.variedad && (
                            <span style={{ marginLeft: '8px', fontSize: '12px', color: colorVar, fontWeight: 500 }}>
                              {String(lote.variedad).split(' ').slice(0, 2).join(' ')}
                            </span>
                          )}
                        </div>

                        {/* Origen → Destino */}
                        {m.tipo === 'trasplante' && (
                          <span style={{ fontSize: '12px', color: '#6b7280' }}>
                            {String(m.fase_origen || '').replace('fase_', 'F').replace('plantin', 'Plant.')}
                            {' → '}
                            {String(m.fase_destino || '').replace('fase_', 'F').replace('plantin', 'Plant.')}
                          </span>
                        )}

                        {/* Ubicación destino */}
                        {m.ubicacion_destino && (
                          <span style={{ fontSize: '11px', color: '#9ca3af', background: '#f9fafb', padding: '2px 6px', borderRadius: '4px' }}>
                            {String(m.ubicacion_destino).replace('Nave 1 - ', '').replace('Nave 2 - ', '')}
                          </span>
                        )}

                        {/* Cantidad */}
                        {unidades && (
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151', minWidth: '70px', textAlign: 'right' }}>
                            {unidades}
                          </span>
                        )}

                        {/* Usuario */}
                        <span style={{ fontSize: '11px', color: '#9ca3af', minWidth: '60px', textAlign: 'right' }}>
                          {usuario}
                        </span>

                        {/* Detalle de la división: cuántos quedan + a dónde se fue el resto */}
                        {m.tipo === 'division' && m.notas && (
                          <span style={{ flexBasis: '100%', fontSize: '11px', color: '#6b7280', fontStyle: 'italic' }}>
                            {m.notas}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
