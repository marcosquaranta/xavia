import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import {
  leerConfigProtocolo, tareasDelDia, tareasVencidas, cumplimientoProtocolo,
  lunesDeSemana, sumarDias, TAREAS_PROTOCOLO, CONFIG_ALARMA_EMAILS, numeroDeMedicion,
  ALARMA_CONDUCTIVIDAD, ALARMA_PH, PATRON_CONDUCTIVIDAD,
} from '@/lib/protocoloTareas';
import type { RegistroProtocolo } from '@/lib/types';
import Header from '@/components/Header';
import TareasProtocolo from '@/components/TareasProtocolo';
import ProtocoloConfig from '@/components/ProtocoloConfig';

export const dynamic = 'force-dynamic';

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const fmtDia = (f: string) => { const [, m, d] = f.split('-'); return `${d}/${m}`; };

const COLOR_ESTADO: Record<string, string> = {
  hecha: '#166534', pendiente: '#92400e', vencida: '#dc2626', no_aplica: '#9ca3af', sin_decidir: '#1d4ed8',
};
const ICONO_ESTADO: Record<string, string> = {
  hecha: '✓', pendiente: '•', vencida: '✕', no_aplica: '–', sin_decidir: '?',
};

export default async function ProtocoloPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let configRows: { clave: string; valor: any }[] = [];
  let registros: RegistroProtocolo[] = [];
  try {
    [configRows, registros] = await Promise.all([
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
      readSheet<RegistroProtocolo>('ProtocoloRegistros').catch(() => []),
    ]);
  } catch {}

  const cfg = leerConfigProtocolo(configRows);
  const hoy = fechaArgentinaHoy();
  const deHoy = tareasDelDia(hoy, cfg, registros, hoy);
  const vencidas = tareasVencidas(cfg, registros, hoy, 14);

  // Semana en curso, lunes a domingo — para ver de un vistazo qué toca cada día.
  const lunes = lunesDeSemana(hoy);
  // Los controles semanales y Serenade no tienen día fijo: están pendientes toda la semana
  // y, si se listaran en los siete casilleros, la grilla diría lo mismo siete veces. Se
  // muestran solo en la columna de hoy, que es donde hay que actuar.
  const SIN_DIA_FIJO = ['control_instrumental', 'control_osmosis', 'riego_serenade'];
  const semana = Array.from({ length: 7 }, (_, i) => {
    const fecha = sumarDias(lunes, i);
    const tareas = tareasDelDia(fecha, cfg, registros, hoy)
      .filter((t) => fecha === hoy || !SIN_DIA_FIJO.includes(t.tarea.id) || !!t.registro);
    return { fecha, dow: DOW[i], tareas };
  });

  // Cumplimiento de las últimas 4 semanas cerradas + la actual.
  const desdeCump = sumarDias(lunes, -21);
  const cumplimiento = cumplimientoProtocolo(desdeCump, hoy, cfg, registros, hoy);

  const ultimos = [...registros]
    .filter((r) => String(r.tipo_registro) === 'ejecucion')
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
    .slice(0, 40);
  // Las MEDICIONES aparte de las aplicaciones. Mezcladas en una sola lista no se puede
  // seguir una serie: entre dos mediciones de ósmosis hay media docena de foliares, y la
  // pregunta que se hace siempre —"¿este número viene subiendo?"— necesita verlas juntas.
  const medicionesDe = (idTarea: string, n = 12) => registros
    .filter((r) => String(r.id_tarea) === idTarea && String(r.tipo_registro) === 'ejecucion' && String(r.estado) !== 'no_aplica')
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
    .slice(0, n);
  const medOsmosis = medicionesDe('control_osmosis');
  const medInstrumental = medicionesDe('control_instrumental');
  // Repara de paso los valores que Sheets había convertido en fechas (ver
  // numeroDeMedicion): las filas viejas se muestran con el número que se cargó.
  const num = (v: any) => numeroDeMedicion(v);

  const nombreTarea = (id: string) => TAREAS_PROTOCOLO.find((t) => t.id === id)?.nombre || id;

  return (
    <>
      <Header user={user} current="protocolo" />
      <div className="container">
        <h1 className="page-title">Protocolo de aplicaciones</h1>
        <p className="page-subtitle">
          Tareas fijas de la temporada · cada una se cierra con responsable, hora y sus datos de registro
        </p>

        {!cfg.activo && (
          <div style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#374151' }}>
              El protocolo está <strong>apagado</strong>: no se muestran tareas en el Panel.
              {user.rol === 'admin' ? ' Activalo abajo cuando arranque la temporada.' : ' Un administrador puede activarlo.'}
            </p>
          </div>
        )}

        {/* ══ HOY ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Hoy · {fmtDia(hoy)}</p>
          {deHoy.length === 0 && vencidas.length === 0 ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: '#059669', fontWeight: 600 }}>
              ✓ No hay aplicaciones ni controles pendientes para hoy.
            </p>
          ) : (
            <TareasProtocolo
              tareas={deHoy}
              vencidas={vencidas}
              esAdmin={user.rol === 'admin'}
              nombreUsuario={user.nombre}
            />
          )}
        </div>

        {/* ══ SEMANA ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Esta semana</p>
          <p className="card-sub">Qué corresponde cada día y cómo quedó</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '8px', marginTop: '10px' }}>
            {semana.map((d) => (
              <div key={d.fecha} style={{
                border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 9px',
                background: d.fecha === hoy ? '#f0fdf4' : 'white',
              }}>
                <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: d.fecha === hoy ? '#166534' : '#6b7280' }}>
                  {d.dow} {fmtDia(d.fecha)}{d.fecha === hoy ? ' · hoy' : ''}
                </p>
                {d.tareas.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '10.5px', color: '#d1d5db' }}>—</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {d.tareas.map((t) => (
                      <span key={t.tarea.id} style={{ fontSize: '10.5px', color: COLOR_ESTADO[t.estado] || '#6b7280', lineHeight: 1.35 }}>
                        {ICONO_ESTADO[t.estado] || '•'} {t.tarea.nombreCorto}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ══ CUMPLIMIENTO ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Cumplimiento · últimas 4 semanas</p>
          <p className="card-sub">
            Cuenta como cumplida la tarea que quedó registrada, incluso si se registró como “no se aplicó”: lo que se controla es que haya una decisión asentada cada vez que correspondía.
          </p>
          <div style={{ overflowX: 'auto', marginTop: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '520px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', color: '#6b7280' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Tarea</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Correspondían</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Hechas</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>No se aplicó</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Sin registrar</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Fuera de rango</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {cumplimiento.map((c) => (
                  <tr key={c.tarea.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{c.tarea.nombre}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{c.correspondian}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#166534' }}>{c.hechas}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{c.noAplica}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: c.pendientes > 0 ? '#dc2626' : '#9ca3af', fontWeight: c.pendientes > 0 ? 700 : 400 }}>{c.pendientes}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: c.fueraDeRango > 0 ? '#d97706' : '#9ca3af', fontWeight: c.fueraDeRango > 0 ? 700 : 400 }}>{c.fueraDeRango}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: c.pct === null ? '#9ca3af' : c.pct >= 90 ? '#166534' : c.pct >= 70 ? '#d97706' : '#dc2626' }}>
                      {c.pct === null ? '—' : `${c.pct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ══ MEDICIONES ══ */}
        {(medOsmosis.length > 0 || medInstrumental.length > 0) && (
          <div className="card" style={{ marginBottom: '14px' }}>
            <p className="card-title">Mediciones</p>
            <p className="card-sub">
              Los valores cargados, uno al lado del otro. En rojo los que se pasaron del límite del protocolo.
            </p>

            {medOsmosis.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <p style={{ margin: '0 0 5px', fontSize: '12.5px', fontWeight: 700, color: '#374151' }}>
                  Agua de ósmosis inversa
                  <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: '11px' }}>
                    {' '}— límites: conductividad hasta {ALARMA_CONDUCTIVIDAD} mS/cm · pH hasta {ALARMA_PH}
                  </span>
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '420px' }}>
                    <thead><tr style={{ background: '#f9fafb', color: '#6b7280' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Fecha</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Quién midió</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>Conductividad</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>pH</th>
                    </tr></thead>
                    <tbody>
                      {medOsmosis.map((r) => {
                        const c = num(r.conductividad), ph = num(r.ph);
                        const malC = c !== null && c > ALARMA_CONDUCTIVIDAD;
                        const malPh = ph !== null && ph > ALARMA_PH;
                        return (
                          <tr key={String(r.id_registro)} style={{ borderTop: '1px solid #f3f4f6', background: malC || malPh ? '#fef2f2' : undefined }}>
                            <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{fmtDia(String(r.fecha))}</td>
                            <td style={{ padding: '4px 8px', color: '#6b7280' }}>{String(r.responsable || '')}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: malC ? '#b91c1c' : '#111827' }}>
                              {c !== null ? `${c} mS/cm` : '—'}
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: malPh ? '#b91c1c' : '#111827' }}>
                              {ph !== null ? ph : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {medInstrumental.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <p style={{ margin: '0 0 5px', fontSize: '12.5px', fontWeight: 700, color: '#374151' }}>
                  Control de instrumental
                  <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: '11px' }}>
                    {' '}— patrones: pH 4,00 · pH 7,00 · conductividad {PATRON_CONDUCTIVIDAD} mS/cm
                  </span>
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '520px' }}>
                    <thead><tr style={{ background: '#f9fafb', color: '#6b7280' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Fecha</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Quién midió</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>pH 4</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>pH 7</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>Patrón</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>¿Calibró?</th>
                    </tr></thead>
                    <tbody>
                      {medInstrumental.map((r) => (
                        <tr key={String(r.id_registro)} style={{ borderTop: '1px solid #f3f4f6', background: String(r.fuera_de_rango) === 'SI' ? '#fef2f2' : undefined }}>
                          <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{fmtDia(String(r.fecha))}</td>
                          <td style={{ padding: '4px 8px', color: '#6b7280' }}>{String(r.responsable || '')}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{num(r.ph4) ?? '—'}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{num(r.ph7) ?? '—'}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{num(r.conductividad_patron) ?? '—'}</td>
                          <td style={{ padding: '4px 8px', color: String(r.calibro) === 'SI' ? '#b45309' : '#6b7280' }}>{String(r.calibro || '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ ÚLTIMOS REGISTROS ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Últimos registros</p>
          {ultimos.length === 0 ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: '#9ca3af' }}>Todavía no hay registros cargados.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', minWidth: '620px' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', color: '#6b7280' }}>
                    <th style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600 }}>Fecha</th>
                    <th style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600 }}>Tarea</th>
                    <th style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600 }}>Responsable</th>
                    <th style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600 }}>Hora</th>
                    <th style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600 }}>Datos</th>
                  </tr>
                </thead>
                <tbody>
                  {ultimos.map((r) => {
                    // TODOS los valores cargados, incluidos los del control de instrumental
                    // —pH 4, pH 7, patrón, si calibró—, que antes no se mostraban en ningún
                    // lado. Cuando salta una alarma lo primero que se pregunta es qué número
                    // se cargó, para saber si el agua está mal o si se fue un decimal.
                    const val = (v: any) => v !== '' && v !== undefined && v !== null;
                    const rep = (v: any) => numeroDeMedicion(v) ?? v;
                    const datos = [
                      r.producto ? String(r.producto) : '',
                      r.dosis ? String(r.dosis) : '',
                      val(r.temperatura) ? `${rep(r.temperatura)} °C` : '',
                      val(r.humedad) ? `${rep(r.humedad)}%` : '',
                      val(r.conductividad) ? `conductividad ${rep(r.conductividad)} mS/cm` : '',
                      val(r.ph) ? `pH ${rep(r.ph)}` : '',
                      val(r.ph4) ? `pH4 → ${rep(r.ph4)}` : '',
                      val(r.ph7) ? `pH7 → ${rep(r.ph7)}` : '',
                      val(r.conductividad_patron) ? `patrón → ${rep(r.conductividad_patron)} mS/cm` : '',
                      val(r.calibro) ? `calibró: ${r.calibro}` : '',
                      val(r.litros) ? `${rep(r.litros)} L` : '',
                    ].filter(Boolean).join(' · ');
                    return (
                      <tr key={String(r.id_registro)} style={{
                        borderTop: '1px solid #f3f4f6',
                        background: String(r.fuera_de_rango) === 'SI' ? '#fef2f2' : undefined,
                      }}>
                        <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{fmtDia(String(r.fecha))}</td>
                        <td style={{ padding: '5px 8px' }}>{nombreTarea(String(r.id_tarea))}</td>
                        <td style={{ padding: '5px 8px' }}>{String(r.responsable || '')}</td>
                        <td style={{ padding: '5px 8px' }}>{String(r.hora || '')}</td>
                        <td style={{ padding: '5px 8px', color: '#6b7280' }}>
                          {String(r.estado) === 'no_aplica' ? <em>no se aplicó</em> : datos || '—'}
                          {String(r.fuera_de_rango) === 'SI' && <span style={{ color: '#dc2626', fontWeight: 700 }}> · fuera de rango</span>}
                          {r.notas ? <div style={{ fontSize: '10.5px', color: '#9ca3af', marginTop: '2px' }}>{String(r.notas)}</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {user.rol === 'admin' && <ProtocoloConfig cfg={cfg} emailsAlarma={String(configRows.find((r) => String(r.clave).trim() === CONFIG_ALARMA_EMAILS)?.valor || '')} />}
      </div>
    </>
  );
}
