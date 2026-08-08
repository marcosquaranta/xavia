import Link from 'next/link';
import { Fragment } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularDiasPorFase, claseVariedad, codigoCultivo, estimarPlantasActuales } from '@/lib/lotes';
import { diasPromedioPorVariedad } from '@/lib/estadisticas';
import { motivoAlertaCosecha } from '@/lib/alertasPanel';
import type { Lote, Movimiento, Variedad, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import AccionesLote from './AccionesLote';
export const dynamic = 'force-dynamic';
export default async function DetalleLotePage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const idLote = decodeURIComponent(params.id);
  let lotes: Lote[] = [], movimientos: Movimiento[] = [], variedades: Variedad[] = [], ubicaciones: Ubicacion[] = [];
  let err: string | null = null;
  try { [lotes, movimientos, variedades, ubicaciones] = await Promise.all([readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Variedad>('Variedades'), readSheet<Ubicacion>('Ubicaciones')]); } catch (e: any) { err = e?.message || 'Error'; }
  if (err) return <><Header user={user} current="cultivos" /><div className="container"><div className="alert-box error">{err}</div><Link href="/cultivos" className="btn secondary" style={{ marginTop: '12px', display: 'inline-block' }}>← Volver</Link></div></>;
  const lote = lotes.find((l) => l.id_lote === idLote);
  if (!lote) notFound();
  let dias: any;
  try { dias = calcularDiasPorFase(lote, movimientos); }
  catch { dias = { plantinera: 0, fase_1: null, fase_2: 0, total: 0, fechas: { siembra: lote.fecha_siembra, fase_1_inicio: null, fase_2_inicio: null, cosecha: null } }; }
  const movsLote = movimientos.filter((m) => m.id_lote === idLote).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  const ult = movsLote[movsLote.length - 1];
  // Cosechas de este lote con alerta de calidad (desvío de cantidad, descarte alto o
  // densidad de rúcula) todavía sin revisar — se revisan acá mismo, con toda la ficha
  // del lote a la vista, en vez de en una página aparte sin contexto.
  const esRuculaLote = codigoCultivo(lote.variedad) === 'R';
  const alertasCosechaLote = movsLote
    .filter((m) => m.alerta_revisada !== 'SI')
    .map((m) => ({ mov: m, motivo: motivoAlertaCosecha(m, esRuculaLote) }))
    .filter((x): x is { mov: Movimiento; motivo: NonNullable<ReturnType<typeof motivoAlertaCosecha>> } => x.motivo !== null);
  const variedad = variedades.find((v) => v.variedad === lote.variedad);
  // Días estimados por fase = promedio real de la variedad (últimos cosechados)
  let est: any = null;
  try { est = diasPromedioPorVariedad(lotes, movimientos, 120).find((d) => d.variedad === lote.variedad) || null; } catch {}
  const estSub = (n: number | null | undefined) => (n && Number(n) > 0 ? `est. ${Math.round(Number(n))} d` : null);
  const labelFase = lote.fase_actual === 'plantin' ? 'Plantinera' : lote.fase_actual === 'fase_1' ? 'Fase 1' : 'Fase 2';
  function fmt(f: string) { if (!f) return '-'; try { const [,m,d] = String(f).split('-'); return d+'/'+m; } catch { return f; } }
  function fmtFull(f: string) { if (!f) return '-'; try { const [y,m,d] = String(f).split('-'); return d+'/'+m+'/'+y; } catch { return f; } }
  function lTipo(t: string) { return { siembra: 'Siembra', trasplante: 'Trasplante', cosecha: 'Cosecha', descarte: 'Descarte', division: 'División' }[t] || t; }
  function lFase(f: string) { return { plantin: 'Plantinera', fase_1: 'Fase 1', fase_2: 'Fase 2' }[f] || f || '-'; }

  // ── Descarte por transición de fase — un mismo cuadro con el % perdido en cada
  // trasplante (Plantín→F1, F1→F2), el de la cosecha si aplica, y el acumulado total. ──
  // Cada trasplante Movimiento ya trae plantas_estimadas (trasplantadas, en plantas
  // reales) y descarte_calculado (también en plantas reales) — % = descarte / (trasplantadas + descarte).
  const transicionesDescarte = movsLote
    .filter((m) => m.tipo === 'trasplante')
    .map((m) => {
      const trasplantadas = Number(m.plantas_estimadas) || 0;
      const descarte = Number(m.descarte_calculado) || 0;
      const disponibleAntes = trasplantadas + descarte;
      const pct = disponibleAntes > 0 ? Math.round((descarte / disponibleAntes) * 1000) / 10 : 0;
      return { id: m.id_movimiento, fecha: String(m.fecha || ''), etiqueta: `${lFase(String(m.fase_origen || ''))} → ${lFase(String(m.fase_destino || ''))}`, descarte, pct };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const movCosecha = movsLote.find((m) => m.tipo === 'cosecha');
  const descarteCosecha = movCosecha ? Number(movCosecha.descarte_calculado) || 0 : 0;
  const disponibleAntesCosecha = movCosecha ? Number(movCosecha.plantas_estimadas) || 0 : 0;
  const pctCosecha = disponibleAntesCosecha > 0 ? Math.round((descarteCosecha / disponibleAntesCosecha) * 1000) / 10 : 0;
  // Acumulado: todo lo perdido (Lote.descarte_reportado, ya suma trasplantes + cosecha)
  // sobre el total que efectivamente pasó por el lote (perdido + lo que sigue vivo o se
  // cosechó) — no usa plantines_iniciales para no arrastrar la conversión ×2 de rúcula.
  // OJO: en rúcula cosechada por paquete, unidades_cosechadas está en PAQUETES, no en
  // plantas (descarte_reportado sí está en plantas) — hay que reconvertir con el mismo
  // plantas/paquete real de esa cosecha, si no la base queda mal y el % sale inflado.
  const totalDescarteAcumulado = Number(lote.descarte_reportado) || 0;
  const cantidadViva = lote.estado === 'cosechado'
    ? (esRuculaLote ? (Number(lote.unidades_cosechadas) || 0) * (Number(lote.plantas_por_unidad_real) || 3) : (Number(lote.unidades_cosechadas) || 0))
    : estimarPlantasActuales(lote, ubicaciones);
  const baseAcumulado = totalDescarteAcumulado + cantidadViva;
  const pctAcumulado = baseAcumulado > 0 ? Math.round((totalDescarteAcumulado / baseAcumulado) * 1000) / 10 : 0;
  const hayDescarte = transicionesDescarte.some((t) => t.descarte > 0) || descarteCosecha > 0 || totalDescarteAcumulado > 0;

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
            ['Plantinera', dias.plantinera + ' d', estSub(est?.plantinera)],
            ...(dias.fase_1 !== null ? [['Fase 1', dias.fase_1 + ' d', estSub(est?.fase_1)]] : []),
            ...(dias.fase_2 > 0 ? [['Fase 2', dias.fase_2 + ' d', estSub(est?.fase_2)]] : []),
            ...(variedad ? [['Ciclo est.', variedad.dias_estimados_cosecha + ' d', 'de la variedad']] : []),
            ...(lote.estado === 'cosechado' ? [
              ['Cosechado', (lote.unidades_cosechadas || 0) + (lote.destino_cosecha === 'planta' ? ' plantas' : ' paq.'), 'unidades'],
              ...((lote.plantas_por_unidad_real && Number(lote.plantas_por_unidad_real) > 1) ? [['Plantas/paquete', lote.plantas_por_unidad_real, 'real']] : []),
              ...((lote.plantines_iniciales) ? [['Plantines usados', lote.plantines_iniciales, 'total del lote']] : []),
              ...(() => {
                // El pasaje testigo es siempre el peso del PAQUETE pesado directamente en la
                // balanza (en lechuga, 1 paquete = 1 planta) — nunca se multiplica por nada.
                const gr = Number(lote.peso_muestra_paquete_gr) > 0
                  ? Number(lote.peso_muestra_paquete_gr)
                  : Number(lote.peso_muestra_kg) > 0 ? Math.round(Number(lote.peso_muestra_kg) * 1000) : 0;
                return gr > 0 ? [['Pasaje testigo', gr + ' g/paq', 'gramos por paquete']] : [];
              })(),
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
        {user.rol === 'admin' && alertasCosechaLote.length > 0 && (
          <div className="card" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
            <p className="card-title" style={{ color: '#991b1b' }}>⚠️ Revisar alerta de cosecha</p>
            {alertasCosechaLote.map(({ mov: m, motivo }) => {
              const descartePct = Number(m.plantas_estimadas) > 0 ? Math.round((Number(m.descarte_calculado) / Number(m.plantas_estimadas)) * 100) : 0;
              const motivoTxt = motivo === 'descarte' ? `Descarte del ${descartePct}% de la cosecha (más de 5%)`
                : motivo === 'densidad' ? `Rúcula armada a ${m.plantas_por_unidad_real} plantas/paquete (más de 3)`
                : `Desvío del ${m.desvio_porcentaje}% en la cantidad cosechada (nivel ${m.nivel_alerta})`;
              return (
                <div key={m.id_movimiento} style={{ marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px dashed #fecaca' }}>
                  <table style={{ marginBottom: '10px' }}><tbody>
                    <tr><td style={{ color: '#7f1d1d', width: '160px' }}>Cosecha del</td><td>{fmtFull(String(m.fecha || ''))}</td></tr>
                    <tr><td style={{ color: '#7f1d1d' }}>Unidades cosechadas</td><td>{m.unidades_cosechadas}</td></tr>
                    <tr><td style={{ color: '#7f1d1d' }}>Motivo</td><td style={{ fontWeight: 700 }}>{motivoTxt}</td></tr>
                  </tbody></table>
                  <form action="/api/alertas/revisar" method="POST">
                    <input type="hidden" name="id_movimiento" value={m.id_movimiento} />
                    <input type="hidden" name="volver" value={`/cultivos/${encodeURIComponent(idLote)}`} />
                    <textarea name="comentario" rows={2} required placeholder="Comentario: causa o resolución" style={{ width: '100%', resize: 'vertical', marginBottom: '8px' }} />
                    <button type="submit" className="btn" style={{ fontSize: '12px' }}>Marcar como revisada</button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
        {hayDescarte && (
          <div className="card">
            <p className="card-title">Descarte</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
              {transicionesDescarte.map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', padding: '8px 12px', background: t.pct > 5 ? '#fef2f2' : '#fafafa', borderRadius: '6px' }}>
                  <span style={{ color: '#374151' }}>{t.etiqueta} <span style={{ color: '#9ca3af', fontSize: '11px' }}>· {fmt(t.fecha)}</span></span>
                  <span>
                    <strong style={{ color: t.pct > 5 ? '#dc2626' : '#111827' }}>{t.pct}%</strong>
                    <span style={{ color: '#9ca3af', fontSize: '12px' }}> ({t.descarte} plantas)</span>
                  </span>
                </div>
              ))}
              {movCosecha && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', padding: '8px 12px', background: pctCosecha > 5 ? '#fef2f2' : '#fafafa', borderRadius: '6px' }}>
                  <span style={{ color: '#374151' }}>Cosecha <span style={{ color: '#9ca3af', fontSize: '11px' }}>· {fmt(String(movCosecha.fecha || ''))}</span></span>
                  <span>
                    <strong style={{ color: pctCosecha > 5 ? '#dc2626' : '#111827' }}>{pctCosecha}%</strong>
                    <span style={{ color: '#9ca3af', fontSize: '12px' }}> ({descarteCosecha} plantas)</span>
                  </span>
                </div>
              )}
            </div>
            <div style={{ textAlign: 'center', padding: '16px', background: pctAcumulado > 5 ? '#fef2f2' : '#f9fafb', border: `1px solid ${pctAcumulado > 5 ? '#fecaca' : '#e5e7eb'}`, borderRadius: '8px' }}>
              <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700 }}>Acumulado del lote</p>
              <p style={{ margin: 0, fontSize: '34px', fontWeight: 800, color: pctAcumulado > 5 ? '#dc2626' : '#111827' }}>{pctAcumulado}%</p>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af' }}>{totalDescarteAcumulado} plantas perdidas de {baseAcumulado} en total</p>
            </div>
          </div>
        )}
        <div className="card">
          <p className="card-title">Historial de movimientos</p>
          {movsLote.length === 0 ? <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>Sin movimientos</p> : (
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Origen</th><th>Destino</th><th style={{ textAlign: 'right' }}>Cant.</th><th>Usuario</th></tr></thead>
              <tbody>
                {movsLote.map((m) => (
                  <Fragment key={m.id_movimiento}>
                    <tr>
                      <td>{fmt(String(m.fecha || ''))}</td><td>{lTipo(String(m.tipo || ''))}</td>
                      <td style={{ color: '#6b7280' }}>{lFase(String(m.fase_origen || ''))}</td>
                      <td style={{ color: '#6b7280' }}>{lFase(String(m.fase_destino || ''))}</td>
                      <td style={{ textAlign: 'right' }}>{m.tipo === 'cosecha' ? (m.unidades_cosechadas || 0) + ' u' : m.tipo === 'division' ? (m.plantas_estimadas || 0) + ' quedan' : m.plantas_estimadas || '-'}</td>
                      <td style={{ color: '#9ca3af', fontSize: '11px' }}>{String(m.usuario || '—').split('@')[0]}</td>
                    </tr>
                    {m.tipo === 'division' && m.notas && (
                      <tr>
                        <td colSpan={6} style={{ color: '#6b7280', fontSize: '11px', fontStyle: 'italic', paddingTop: 0, paddingBottom: '8px' }}>{m.notas}</td>
                      </tr>
                    )}
                  </Fragment>
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