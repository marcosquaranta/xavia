import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularDiasPorFase, claseVariedad } from '@/lib/lotes';
import type { Lote, Movimiento, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import AccionesLote from './AccionesLote';
export const dynamic = 'force-dynamic';
export default async function DetalleLotePage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const idLote = decodeURIComponent(params.id);
  let lotes: Lote[] = [], movimientos: Movimiento[] = [], variedades: Variedad[] = [];
  let err: string | null = null;
  try { [lotes, movimientos, variedades] = await Promise.all([readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Variedad>('Variedades')]); } catch (e: any) { err = e?.message || 'Error'; }
  if (err) return <><Header user={user} current="cultivos" /><div className="container"><div className="alert-box error">{err}</div><Link href="/cultivos" className="btn secondary" style={{ marginTop: '12px', display: 'inline-block' }}>← Volver</Link></div></>;
  const lote = lotes.find((l) => l.id_lote === idLote);
  if (!lote) notFound();
  let dias: any;
  try { dias = calcularDiasPorFase(lote, movimientos); }
  catch { dias = { plantinera: 0, fase_1: null, fase_2: 0, total: 0, fechas: { siembra: lote.fecha_siembra, fase_1_inicio: null, fase_2_inicio: null, cosecha: null } }; }
  const movsLote = movimientos.filter((m) => m.id_lote === idLote).sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
  const ult = movsLote[movsLote.length - 1];
  const variedad = variedades.find((v) => v.variedad === lote.variedad);
  const labelFase = lote.fase_actual === 'plantin' ? 'Plantinera' : lote.fase_actual === 'fase_1' ? 'Fase 1' : 'Fase 2';
  function fmt(f: string) { if (!f) return '-'; try { const [,m,d] = String(f).split('-'); return d+'/'+m; } catch { return f; } }
  function fmtFull(f: string) { if (!f) return '-'; try { const [y,m,d] = String(f).split('-'); return d+'/'+m+'/'+y; } catch { return f; } }
  function lTipo(t: string) { return { siembra: 'Siembra', trasplante: 'Trasplante', cosecha: 'Cosecha', descarte: 'Descarte' }[t] || t; }
  function lFase(f: string) { return { plantin: 'Plantinera', fase_1: 'Fase 1', fase_2: 'Fase 2' }[f] || f || '-'; }
  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <Link href="/cultivos" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Mis cultivos</Link>
        <div className={'lote-row ' + claseVariedad(lote)} style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span className="lote-id" style={{ fontSize: '14px' }}>Nro Lote: {lote.id_lote}</span>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{lote.variedad}</h1>
            <span className={'pill ' + (lote.estado === 'cosechado' ? 'fase2' : 'fase1')}>{lote.estado === 'cosechado' ? 'Cosechado' : labelFase}</span>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#6b7280' }}>{lote.ubicacion_actual || '—'} · {lote.estado === 'cosechado' ? 'cosechado el ' + fmt(lote.fecha_cosecha) : 'plantines iniciales: ' + (lote.plantines_iniciales || 0)}</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {[
            ['Sembrado', fmtFull(dias.fechas.siembra), 'hace ' + dias.total + ' días'],
            ['Plantinera', dias.plantinera + ' d', null],
            ...(dias.fase_1 !== null ? [['Fase 1', dias.fase_1 + ' d', null]] : []),
            ...(dias.fase_2 > 0 ? [['Fase 2', dias.fase_2 + ' d', null]] : []),
            ...(variedad ? [['Ciclo est.', variedad.dias_estimados_cosecha + ' d', 'de la variedad']] : []),
            ...(lote.estado === 'cosechado' ? [
              ['Cosechado', (lote.unidades_cosechadas || 0) + (lote.destino_cosecha === 'planta' ? ' plantas' : ' paq.'), 'unidades'],
              ...((lote.descarte_reportado && Number(lote.descarte_reportado) > 0) ? [['Descarte', lote.descarte_reportado + ' plantas', null]] : []),
              ...((lote.plantas_por_unidad_real && Number(lote.plantas_por_unidad_real) > 1) ? [['Plantas/paquete', lote.plantas_por_unidad_real, 'real']] : []),
              ...((lote.plantines_iniciales) ? [['Plantines usados', lote.plantines_iniciales, 'total del lote']] : []),
            ] : []),
          ].map(([label, value, sub]: any) => (
            <div key={label} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '14px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</p>
              <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 600 }}>{value}</p>
              {sub && <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#9ca3af' }}>{sub}</p>}
            </div>
          ))}
        </div>
        <AccionesLote idLote={lote.id_lote} faseActual={String(lote.fase_actual)} estado={String(lote.estado)} esAdmin={user.rol === 'admin'} ultimoMovId={ult?.id_movimiento} ultimoMovTipo={String(ult?.tipo || '')} ultimoMovFecha={fmt(String(ult?.fecha || ''))} />
        <div className="card">
          <p className="card-title">Historial de movimientos</p>
          {movsLote.length === 0 ? <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>Sin movimientos</p> : (
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Origen</th><th>Destino</th><th style={{ textAlign: 'right' }}>Cant.</th><th>Usuario</th></tr></thead>
              <tbody>
                {movsLote.map((m) => (
                  <tr key={m.id_movimiento}>
                    <td>{fmt(String(m.fecha || ''))}</td><td>{lTipo(String(m.tipo || ''))}</td>
                    <td style={{ color: '#6b7280' }}>{lFase(String(m.fase_origen || ''))}</td>
                    <td style={{ color: '#6b7280' }}>{lFase(String(m.fase_destino || ''))}</td>
                    <td style={{ textAlign: 'right' }}>{m.tipo === 'cosecha' ? (m.unidades_cosechadas || 0) + ' u' : m.plantas_estimadas || '-'}</td>
                    <td style={{ color: '#9ca3af', fontSize: '11px' }}>{String(m.usuario || '—').split('@')[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {lote.notas && <div className="card"><p className="card-title">Notas</p><p style={{ margin: 0, fontSize: '13px', whiteSpace: 'pre-wrap' }}>{lote.notas}</p></div>}
      </div>
    </>
  );
}