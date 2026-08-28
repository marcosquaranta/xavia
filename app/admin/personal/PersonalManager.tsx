'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Empleado } from '@/lib/types';
import { horasTeoricasAuto, rangoQuincena, type ResumenEmpleado } from '@/lib/personal';

interface Props { resumen: ResumenEmpleado[]; empleados: Empleado[]; anio: number; mes: number; quincena: 1 | 2; }

const fmtN = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
// Horas de más/de menos van siempre en enteras (ya vienen redondeadas desde calcularResumenQuincena) — a diferencia de fmtN, sin decimales.
const fmtH = (n: number) => Math.round(n).toLocaleString('es-AR');

export default function PersonalManager({ resumen, empleados, anio, mes, quincena }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<{ workno: string; modo: 'dias' | 'tardanzas' } | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(workno: string, modo: 'dias' | 'tardanzas') {
    setAbierto((v) => (v && v.workno === workno && v.modo === modo ? null : { workno, modo }));
  }

  function empezarEdicion(r: ResumenEmpleado) {
    const emp = empleados.find((e) => String(e.workno) === r.workno);
    setForm({
      sueldo_hora: String(emp?.sueldo_hora || 0),
      horas_teoricas_quincena: String(emp?.horas_teoricas_quincena || 46),
      horas_lv: String(emp?.horas_lv || 0),
      horas_sabado: String(emp?.horas_sabado || 0),
      presentismo: String(emp?.presentismo ?? 50000),
      hora_entrada_esperada: emp?.hora_entrada_esperada || '08:00',
      hora_entrada_esperada_sabado: emp?.hora_entrada_esperada_sabado || '',
      hora_salida_esperada: emp?.hora_salida_esperada || '17:00',
      presentismo_manual: r.presentismoManual || '',
      extras: String(r.extras || 0),
      horas_extras: String(r.horasExtras || 0),
    });
    setEditando(r.workno);
    setError(null);
  }

  async function guardar(r: ResumenEmpleado) {
    setGuardando(r.workno); setError(null);
    const emp = empleados.find((e) => String(e.workno) === r.workno);
    const campos = {
      sueldo_hora: Number(form.sueldo_hora) || 0,
      horas_teoricas_quincena: Number(form.horas_teoricas_quincena) || 46,
      horas_lv: Number(form.horas_lv) || 0,
      horas_sabado: Number(form.horas_sabado) || 0,
      presentismo: Number(form.presentismo) || 0,
      hora_entrada_esperada: form.hora_entrada_esperada,
      hora_entrada_esperada_sabado: form.hora_entrada_esperada_sabado,
      hora_salida_esperada: form.hora_salida_esperada,
    };
    try {
      const res = emp
        ? await fetch('/api/admin/empleados', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workno: r.workno, ...campos }) })
        : await fetch('/api/admin/empleados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workno: r.workno, nombre: r.nombre, ...campos }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      const resAjuste = await fetch('/api/admin/personal-quincena', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workno: r.workno, anio, mes, quincena,
          presentismo_manual: form.presentismo_manual || '',
          extras: Number(form.extras) || 0,
          horas_extras: Number(form.horas_extras) || 0,
        }),
      });
      if (!resAjuste.ok) { const j = await resAjuste.json().catch(() => ({})); throw new Error(j.error || 'Error guardando ajustes de la quincena'); }
      setEditando(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message || 'Error al guardar');
    } finally {
      setGuardando(null);
    }
  }

  if (!resumen.length) {
    return <div className="card" style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>No hay fichajes de CrossChex en este período.</div>;
  }

  return (
    <div className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '12px' }}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: '13px', width: '100%' }}>
          <thead>
            <tr>
              <th>Empleado</th>
              <th style={{ textAlign: 'right' }}>Hs. reales</th>
              <th style={{ textAlign: 'right' }}>Hs. teóricas</th>
              <th style={{ textAlign: 'right' }}>Diferencia</th>
              <th style={{ textAlign: 'right' }}>Hs. de más<br /><span style={{ fontWeight: 400, fontSize: '10px', color: '#9ca3af' }}>(vs. esperado)</span></th>
              <th style={{ textAlign: 'right' }}>Hs. de menos<br /><span style={{ fontWeight: 400, fontSize: '10px', color: '#9ca3af' }}>(vs. esperado)</span></th>
              <th style={{ textAlign: 'right' }}>Sueldo/hora</th>
              <th style={{ textAlign: 'right' }}>Presentismo</th>
              <th style={{ textAlign: 'right' }}>Extras</th>
              <th style={{ textAlign: 'right' }}>Hs. extras</th>
              <th style={{ textAlign: 'right' }}>Sueldo a pagar</th>
              <th style={{ textAlign: 'center' }}>Tardanzas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {resumen.map((r) => {
              const emp = empleados.find((e) => String(e.workno) === r.workno);
              const esNuevo = !emp;
              const editandoEsta = editando === r.workno;
              const { diasDesde, diasHasta } = rangoQuincena(anio, mes, quincena);
              const horasTeoricasPreview = editandoEsta && (Number(form.horas_lv) || 0) > 0
                ? horasTeoricasAuto(anio, mes, diasDesde, diasHasta, Number(form.horas_lv) || 0, Number(form.horas_sabado) || 0)
                : Number(form.horas_teoricas_quincena) || 0;
              const sueldoPreview = editandoEsta
                ? (() => {
                    const cumplioPreview = form.presentismo_manual === 'SI' ? true : form.presentismo_manual === 'NO' ? false : (r.tardanzas < 2 && r.faltas === 0);
                    const presentismoPreview = cumplioPreview ? (Number(form.presentismo) || 0) : 0;
                    return horasTeoricasPreview * (Number(form.sueldo_hora) || 0) + presentismoPreview + (Number(form.extras) || 0) + (Number(form.horas_extras) || 0) * (Number(form.sueldo_hora) || 0);
                  })()
                : r.sueldoAPagar;
              const diasTarde = r.dias.filter((d) => d.esTardanza);
              return (
                <Fragment key={r.workno}>
                  <tr style={{ borderTop: '1px solid #f3f4f6', background: esNuevo ? '#fffbeb' : 'transparent' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ fontWeight: 600 }}>{r.nombre}</span>
                      <span style={{ marginLeft: '6px', fontSize: '10px', color: '#9ca3af' }}>#{r.workno}</span>
                      {esNuevo && <span style={{ marginLeft: '6px', fontSize: '10px', background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '3px', fontWeight: 700 }}>sin configurar</span>}
                      {r.diasIncompletos > 0 && (
                        <span title={`${r.diasIncompletos} día(s) con un solo fichaje — no se pudo calcular la salida`} style={{ marginLeft: '6px', fontSize: '10px', background: '#fee2e2', color: '#dc2626', padding: '1px 6px', borderRadius: '3px', fontWeight: 700 }}>
                          ⚠ {r.diasIncompletos} incompleto(s)
                        </span>
                      )}
                      {r.faltas > 0 && (
                        <span title={`${r.faltas} día(s) programado(s) sin ningún fichaje — pierde el presentismo`} style={{ marginLeft: '6px', fontSize: '10px', background: '#fee2e2', color: '#dc2626', padding: '1px 6px', borderRadius: '3px', fontWeight: 700 }}>
                          ⚠ {r.faltas} falta(s)
                        </span>
                      )}
                      {emp && <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#9ca3af' }}>Horario esperado: {emp.hora_entrada_esperada || '—'} a {emp.hora_salida_esperada || '—'}{emp.hora_entrada_esperada_sabado ? ' · sáb. desde ' + emp.hora_entrada_esperada_sabado : ''}</p>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtN(r.horasReales)} hs</td>
                    <td style={{ textAlign: 'right', color: '#6b7280' }}>{editandoEsta ? (
                      (Number(form.horas_lv) || 0) > 0 ? (
                        <span title="Se calcula sola del calendario — configurala en 'Horas por día' más abajo">{fmtN(horasTeoricasPreview)} hs</span>
                      ) : (
                        <input type="number" min={0} value={form.horas_teoricas_quincena} onChange={(e) => setForm((f) => ({ ...f, horas_teoricas_quincena: e.target.value }))}
                          style={{ width: '70px', textAlign: 'right', fontSize: '12px' }} />
                      )
                    ) : (
                      <span title={r.horasTeoricasAuto ? 'Calculado solo del calendario (horas por día configuradas)' : 'Número manual — configurá "horas por día" para que se calcule solo'}>
                        {fmtN(r.horasTeoricas)} hs{r.horasTeoricasAuto && <span style={{ marginLeft: '3px', fontSize: '9px', color: '#a78bfa' }}>(auto)</span>}
                      </span>
                    )}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: r.diferenciaHoras < 0 ? '#dc2626' : r.diferenciaHoras > 0 ? '#059669' : '#6b7280' }}>
                      {r.diferenciaHoras > 0 ? '+' : ''}{fmtN(r.diferenciaHoras)} hs
                    </td>
                    <td style={{ textAlign: 'right', color: r.horasDeMasTotal > 0 ? '#d97706' : '#9ca3af' }}>
                      {r.horasDeMasTotal > 0 ? `${fmtH(r.horasDeMasTotal)} hs` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: r.horasDeMenosTotal > 0 ? '#dc2626' : '#9ca3af' }}>
                      {r.horasDeMenosTotal > 0 ? `${fmtH(r.horasDeMenosTotal)} hs` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{editandoEsta ? (
                      <input type="number" min={0} value={form.sueldo_hora} onChange={(e) => setForm((f) => ({ ...f, sueldo_hora: e.target.value }))}
                        style={{ width: '80px', textAlign: 'right', fontSize: '12px' }} />
                    ) : fmt$(r.sueldoHora)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {editandoEsta ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
                          <input type="number" min={0} value={form.presentismo} onChange={(e) => setForm((f) => ({ ...f, presentismo: e.target.value }))}
                            style={{ width: '80px', textAlign: 'right', fontSize: '12px' }} />
                          <select value={form.presentismo_manual} onChange={(e) => setForm((f) => ({ ...f, presentismo_manual: e.target.value }))} style={{ fontSize: '11px' }}>
                            <option value="">Auto (según tardanzas)</option>
                            <option value="SI">Cumplió (SI)</option>
                            <option value="NO">No cumplió (NO)</option>
                          </select>
                        </div>
                      ) : (
                        <span title={r.presentismoManual ? `Forzado a mano: ${r.presentismoManual}` : `Automático: se pierde por falta (${r.faltas}) o por 2+ tardanzas (${r.tardanzas})`} style={{ color: r.presentismoAplicado > 0 ? '#059669' : '#dc2626' }}>
                          {r.presentismoAplicado > 0 ? fmt$(r.presentismoAplicado) : `${fmt$(r.presentismoConfigurado)} (perdido)`}
                          {r.presentismoManual && <span style={{ marginLeft: '4px', fontSize: '10px', color: '#9ca3af' }}>(manual)</span>}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{editandoEsta ? (
                      <input type="number" value={form.extras} onChange={(e) => setForm((f) => ({ ...f, extras: e.target.value }))}
                        style={{ width: '80px', textAlign: 'right', fontSize: '12px' }} />
                    ) : (r.extras !== 0 ? fmt$(r.extras) : '—')}</td>
                    <td style={{ textAlign: 'right' }}>{editandoEsta ? (
                      <input type="number" min={0} value={form.horas_extras} onChange={(e) => setForm((f) => ({ ...f, horas_extras: e.target.value }))}
                        style={{ width: '70px', textAlign: 'right', fontSize: '12px' }} />
                    ) : (r.horasExtras !== 0 ? `${fmtN(r.horasExtras)} hs` : '—')}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt$(sueldoPreview)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {r.tardanzas > 0 ? (
                        <button onClick={() => toggle(r.workno, 'tardanzas')} style={{ color: '#dc2626', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px' }}>
                          {r.tardanzas}
                        </button>
                      ) : <span style={{ color: '#059669' }}>0</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => toggle(r.workno, 'dias')} style={{ fontSize: '11px', background: 'none', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', marginRight: '4px' }}>
                        {abierto?.workno === r.workno && abierto.modo === 'dias' ? 'Ocultar' : 'Días'}
                      </button>
                      {editandoEsta ? (
                        <>
                          <button onClick={() => guardar(r)} disabled={guardando === r.workno} style={{ fontSize: '11px', background: '#166534', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', marginRight: '4px' }}>
                            {guardando === r.workno ? '…' : 'Guardar'}
                          </button>
                          <button onClick={() => setEditando(null)} style={{ fontSize: '11px', background: 'none', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}>Cancelar</button>
                        </>
                      ) : (
                        <button onClick={() => empezarEdicion(r)} style={{ fontSize: '11px', background: 'none', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}>
                          {esNuevo ? 'Configurar' : 'Editar'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {editandoEsta && (
                    <tr style={{ background: '#f9fafb' }}>
                      <td colSpan={13} style={{ padding: '8px 12px', fontSize: '12px', color: '#6b7280' }}>
                        <div style={{ marginBottom: '6px' }}>
                          Horario esperado (para calcular tardanzas):{' '}
                          <input type="time" value={form.hora_entrada_esperada} onChange={(e) => setForm((f) => ({ ...f, hora_entrada_esperada: e.target.value }))} style={{ fontSize: '12px', marginRight: '8px' }} />
                          a{' '}
                          <input type="time" value={form.hora_salida_esperada} onChange={(e) => setForm((f) => ({ ...f, hora_salida_esperada: e.target.value }))} style={{ fontSize: '12px' }} />
                        </div>
                        <div style={{ marginBottom: '6px' }}>
                          Entrada los sábados:{' '}
                          <input type="time" value={form.hora_entrada_esperada_sabado} onChange={(e) => setForm((f) => ({ ...f, hora_entrada_esperada_sabado: e.target.value }))} style={{ fontSize: '12px' }} />
                          <span style={{ marginLeft: '10px', color: '#9ca3af' }}>
                            Vacío = usa la de lunes a viernes ({form.hora_entrada_esperada || '—'}). Cargala si los sábados entran más tarde, si no marca tardanza a todos.
                          </span>
                        </div>
                        <div>
                          Horas por día — lunes a viernes:{' '}
                          <input type="number" min={0} step={0.5} value={form.horas_lv} onChange={(e) => setForm((f) => ({ ...f, horas_lv: e.target.value }))} style={{ width: '55px', fontSize: '12px', marginRight: '8px' }} />
                          sábado (horario diferenciado):{' '}
                          <input type="number" min={0} step={0.5} value={form.horas_sabado} onChange={(e) => setForm((f) => ({ ...f, horas_sabado: e.target.value }))} style={{ width: '55px', fontSize: '12px' }} />
                          <span style={{ marginLeft: '10px', color: '#9ca3af' }}>
                            {(Number(form.horas_lv) || 0) > 0
                              ? `→ Hs. teóricas esta quincena: ${fmtN(horasTeoricasPreview)} hs (se calcula sola)`
                              : 'Dejalo en 0 para seguir usando el número manual de "Hs. teóricas"'}
                          </span>
                        </div>
                        <p style={{ margin: '6px 0 0', color: '#9ca3af' }}>Presentismo, Extras y Hs. extras de esta fila son para ESTA quincena únicamente.</p>
                      </td>
                    </tr>
                  )}
                  {abierto?.workno === r.workno && abierto.modo === 'tardanzas' && (
                    <tr>
                      <td colSpan={13} style={{ padding: '8px 12px', background: '#fef2f2' }}>
                        {diasTarde.length === 0 ? <span style={{ fontSize: '12px', color: '#9ca3af' }}>Sin tardanzas.</span> : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {diasTarde.map((d) => (
                              <span key={d.fecha} style={{ fontSize: '12px', color: '#7f1d1d' }}>
                                <strong>{d.fecha}</strong> — llegó a las <strong>{d.entrada}</strong> ({d.tardanzaMin} min tarde)
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  {abierto?.workno === r.workno && abierto.modo === 'dias' && (
                    <tr>
                      <td colSpan={13} style={{ padding: '8px 12px', background: '#fafafa' }}>
                        {r.dias.length === 0 ? <span style={{ fontSize: '12px', color: '#9ca3af' }}>Sin fichajes en el período.</span> : (
                          <table style={{ fontSize: '12px', width: '100%' }}>
                            <thead><tr>
                              <th style={{ textAlign: 'left' }}>Fecha</th>
                              <th style={{ textAlign: 'right' }}>Entrada</th>
                              <th style={{ textAlign: 'right' }}>Salida</th>
                              <th style={{ textAlign: 'right' }}>Horas</th>
                              <th style={{ textAlign: 'right' }}>Correspondían</th>
                              <th style={{ textAlign: 'right' }}>Hs. de más</th>
                              <th style={{ textAlign: 'right' }}>Hs. de menos</th>
                              <th style={{ textAlign: 'right' }}>Tardanza</th>
                            </tr></thead>
                            <tbody>
                              {r.dias.map((d) => (
                                <tr key={d.fecha} style={{ background: d.esDomingo ? '#f5f3ff' : 'transparent' }}>
                                  <td>{d.fecha} <span style={{ color: d.esDomingo ? '#7c3aed' : '#9ca3af', fontWeight: d.esDomingo ? 700 : 400 }}>({d.diaSemana})</span></td>
                                  <td style={{ textAlign: 'right' }}>{d.entrada}</td>
                                  <td style={{ textAlign: 'right', color: d.incompleto ? '#dc2626' : undefined }}>{d.salida || '— (incompleto)'}</td>
                                  <td style={{ textAlign: 'right' }}>{d.incompleto ? '—' : `${fmtN(d.horas)} hs`}</td>
                                  <td style={{ textAlign: 'right', color: '#9ca3af' }}>{d.horasEsperadas !== null ? `${fmtN(d.horasEsperadas)} hs` : '—'}</td>
                                  <td style={{ textAlign: 'right', color: d.horasDeMas > 0 ? '#d97706' : '#9ca3af' }}>
                                    {d.horasDeMas > 0 ? `${fmtH(d.horasDeMas)} hs${d.esDomingo ? ' (domingo)' : ''}` : '—'}
                                  </td>
                                  <td style={{ textAlign: 'right', color: d.horasDeMenos > 0 ? '#dc2626' : '#9ca3af' }}>{d.horasDeMenos > 0 ? `${fmtH(d.horasDeMenos)} hs` : '—'}</td>
                                  <td style={{ textAlign: 'right', color: d.esTardanza ? '#dc2626' : '#9ca3af' }}>{d.tardanzaMin > 0 ? `${d.tardanzaMin} min${d.esTardanza ? '' : ' (dentro del margen)'}` : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#9ca3af' }}>
        Entrada = primer fichaje del día · Salida = último fichaje del día. Tolerancia de 15 min para tardanzas (quedan siempre en minutos, sin redondear); un ingreso pasadas las 11 no cuenta (día raro/franco). "Hs. de más"/"Hs. de menos" comparan contra lo esperado ese día según horario configurado (o turno de 8hs si no hay horario cargado) — de más solo cuenta si supera 1 hora, y ambas se redondean a horas enteras. Los domingos no son día programado: cualquier hora trabajada un domingo cuenta directo como "de más" (marcada "domingo"). "Sueldo a pagar" = horas teóricas × sueldo/hora + presentismo (si corresponde) + extras + horas extra × sueldo/hora. Presentismo se pierde por falta o por 2 o más tardanzas en la quincena. "Hs. teóricas (auto)" se calcula sola del calendario si el empleado tiene "horas por día" configuradas; si no, es el número manual de siempre.
      </p>
    </div>
  );
}
