'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Empleado } from '@/lib/types';
import type { ResumenEmpleado } from '@/lib/personal';

interface Props { resumen: ResumenEmpleado[]; empleados: Empleado[]; }

const fmtN = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

export default function PersonalManager({ resumen, empleados }: Props) {
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
      presentismo: String(emp?.presentismo ?? 50000),
      hora_entrada_esperada: emp?.hora_entrada_esperada || '08:00',
      hora_salida_esperada: emp?.hora_salida_esperada || '17:00',
    });
    setEditando(r.workno);
    setError(null);
  }

  async function guardar(r: ResumenEmpleado) {
    setGuardando(r.workno); setError(null);
    const emp = empleados.find((e) => String(e.workno) === r.workno);
    const campos = {
      ...form,
      sueldo_hora: Number(form.sueldo_hora) || 0,
      horas_teoricas_quincena: Number(form.horas_teoricas_quincena) || 46,
      presentismo: Number(form.presentismo) || 0,
    };
    try {
      const res = emp
        ? await fetch('/api/admin/empleados', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workno: r.workno, ...campos }) })
        : await fetch('/api/admin/empleados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workno: r.workno, nombre: r.nombre, ...campos }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
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
              <th style={{ textAlign: 'right' }}>Sueldo/hora</th>
              <th style={{ textAlign: 'right' }}>Presentismo</th>
              <th style={{ textAlign: 'right' }}>Sueldo a pagar</th>
              <th style={{ textAlign: 'center' }}>Tardanzas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {resumen.map((r) => {
              const esNuevo = !empleados.find((e) => String(e.workno) === r.workno);
              const editandoEsta = editando === r.workno;
              const sueldoPreview = editandoEsta
                ? (Number(form.horas_teoricas_quincena) || 0) * (Number(form.sueldo_hora) || 0) + (r.tardanzas === 0 ? (Number(form.presentismo) || 0) : 0)
                : r.sueldoAPagar;
              const diasTarde = r.dias.filter((d) => d.tardanzaMin > 0);
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
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtN(r.horasReales)} hs</td>
                    <td style={{ textAlign: 'right', color: '#6b7280' }}>{editandoEsta ? (
                      <input type="number" min={0} value={form.horas_teoricas_quincena} onChange={(e) => setForm((f) => ({ ...f, horas_teoricas_quincena: e.target.value }))}
                        style={{ width: '70px', textAlign: 'right', fontSize: '12px' }} />
                    ) : `${fmtN(r.horasTeoricas)} hs`}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: r.diferenciaHoras < 0 ? '#dc2626' : r.diferenciaHoras > 0 ? '#059669' : '#6b7280' }}>
                      {r.diferenciaHoras > 0 ? '+' : ''}{fmtN(r.diferenciaHoras)} hs
                    </td>
                    <td style={{ textAlign: 'right' }}>{editandoEsta ? (
                      <input type="number" min={0} value={form.sueldo_hora} onChange={(e) => setForm((f) => ({ ...f, sueldo_hora: e.target.value }))}
                        style={{ width: '80px', textAlign: 'right', fontSize: '12px' }} />
                    ) : fmt$(r.sueldoHora)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {editandoEsta ? (
                        <input type="number" min={0} value={form.presentismo} onChange={(e) => setForm((f) => ({ ...f, presentismo: e.target.value }))}
                          style={{ width: '80px', textAlign: 'right', fontSize: '12px' }} />
                      ) : (
                        <span title={r.tardanzas === 0 ? 'Se paga: sin tardanzas en la quincena' : 'No se paga: hubo tardanzas en la quincena'} style={{ color: r.presentismoAplicado > 0 ? '#059669' : '#dc2626' }}>
                          {r.presentismoAplicado > 0 ? fmt$(r.presentismoAplicado) : `${fmt$(r.presentismoConfigurado)} (perdido)`}
                        </span>
                      )}
                    </td>
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
                      <td colSpan={9} style={{ padding: '8px 12px', fontSize: '12px', color: '#6b7280' }}>
                        Horario esperado (para calcular tardanzas):{' '}
                        <input type="time" value={form.hora_entrada_esperada} onChange={(e) => setForm((f) => ({ ...f, hora_entrada_esperada: e.target.value }))} style={{ fontSize: '12px', marginRight: '8px' }} />
                        a{' '}
                        <input type="time" value={form.hora_salida_esperada} onChange={(e) => setForm((f) => ({ ...f, hora_salida_esperada: e.target.value }))} style={{ fontSize: '12px' }} />
                      </td>
                    </tr>
                  )}
                  {abierto?.workno === r.workno && abierto.modo === 'tardanzas' && (
                    <tr>
                      <td colSpan={9} style={{ padding: '8px 12px', background: '#fef2f2' }}>
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
                      <td colSpan={9} style={{ padding: '8px 12px', background: '#fafafa' }}>
                        {r.dias.length === 0 ? <span style={{ fontSize: '12px', color: '#9ca3af' }}>Sin fichajes en el período.</span> : (
                          <table style={{ fontSize: '12px', width: '100%' }}>
                            <thead><tr><th style={{ textAlign: 'left' }}>Fecha</th><th style={{ textAlign: 'right' }}>Entrada</th><th style={{ textAlign: 'right' }}>Salida</th><th style={{ textAlign: 'right' }}>Horas</th><th style={{ textAlign: 'right' }}>Tardanza</th></tr></thead>
                            <tbody>
                              {r.dias.map((d) => (
                                <tr key={d.fecha}>
                                  <td>{d.fecha}</td>
                                  <td style={{ textAlign: 'right' }}>{d.entrada}</td>
                                  <td style={{ textAlign: 'right', color: d.incompleto ? '#dc2626' : undefined }}>{d.salida || '— (incompleto)'}</td>
                                  <td style={{ textAlign: 'right' }}>{d.incompleto ? '—' : `${fmtN(d.horas)} hs`}</td>
                                  <td style={{ textAlign: 'right', color: d.tardanzaMin > 0 ? '#dc2626' : '#9ca3af' }}>{d.tardanzaMin > 0 ? `${d.tardanzaMin} min` : '—'}</td>
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
        Entrada = primer fichaje del día · Salida = último fichaje del día (CrossChex no distingue entrada/salida de forma confiable). Un ingreso pasadas las 11 no cuenta como tardanza (día raro/franco). "Sueldo a pagar" = horas teóricas × sueldo/hora, más el presentismo si no hubo tardanzas.
      </p>
    </div>
  );
}
