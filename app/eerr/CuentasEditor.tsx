'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MEDIOS_PAGO } from '@/lib/types';
import type { SaldoMes, MovimientoCuentaDetalle } from '@/lib/cuentas';

// ── Saldos de cada cuenta y movimientos entre cuentas ──────────────────────────
//
// Esto es el extracto del mes de cada cuenta: con qué arrancó, qué entró, qué salió y con
// qué termina, contra el saldo real del resumen. La diferencia es plata que se movió sin
// quedar registrada: mientras no sea cero, falta cargar algo.
//
// Las cobranzas NO se cargan acá. Entran por la bandeja de Cobranzas, que es donde están
// las facturas y el cliente; cargarlas también acá era un segundo lugar para lo mismo y la
// garantía de contar dos veces el mismo cobro.
//
// Los movimientos ENTRE cuentas sí: pagar el resumen de la tarjeta o pasar plata de un banco
// a otro no es un gasto —la plata sigue siendo de la empresa— pero mueve los dos saldos, y
// sin cargarlos la conciliación no cierra nunca. Antes existían (como gasto de categoría
// "movimiento interno") pero no se veían por ningún lado: la columna "entre cuentas" daba
// un número y no había forma de saber de dónde salía.

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const cel: React.CSSProperties = { padding: '5px 8px', fontSize: '12.5px' };
const celNum: React.CSSProperties = { ...cel, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

// Qué clase de movimiento es cada línea del extracto. Importa distinguir un gasto de una
// salida hacia otra cuenta: el primero es plata que se fue de la empresa, el segundo no.
const ETIQUETA: Record<string, { texto: string; color: string }> = {
  cobro: { texto: 'cobro', color: '#059669' },
  gasto: { texto: 'gasto', color: '#b45309' },
  entra: { texto: 'entre cuentas', color: '#6b7280' },
  sale: { texto: 'entre cuentas', color: '#6b7280' },
};

// Las cuentas cuyo saldo es una deuda y por lo tanto va en negativo.
const CUENTAS_DEUDA = ['VISA'];

export interface MovimientoCuenta {
  id_gasto: string;
  fecha: string;
  descripcion: string;
  monto: number;
  origen: string;
  destino: string;
}

export default function CuentasEditor({ anio, mes, saldos, movimientos, detalle = {} }: {
  anio: number; mes: number; saldos: SaldoMes[];
  movimientos: MovimientoCuenta[];
  // El extracto de cada cuenta: todos los movimientos que forman el saldo calculado. Ver
  // movimientosDeCuenta en lib/cuentas.ts.
  detalle?: Record<string, MovimientoCuentaDetalle[]>;
}) {
  const router = useRouter();
  // Los límites del mes que se está cerrando. El formulario arranca en el último día de ESE
  // mes, no en hoy: si estás cerrando septiembre en octubre, la fecha de hoy carga la
  // transferencia en el mes equivocado.
  const primerDia = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = `${anio}-${String(mes).padStart(2, '0')}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
  const [fecha, setFecha] = useState(ultimoDia);
  const [origen, setOrigen] = useState<string>(MEDIOS_PAGO[0]);
  const [destino, setDestino] = useState<string>(MEDIOS_PAGO[1]);
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El saldo inicial normalmente no se toca: es el cierre del mes anterior. Pero el primer
  // mes ese cierre no existe, y sin poder sembrarlo la conciliación nunca puede dar. Se
  // guarda como el saldo REAL del mes anterior, que es exactamente lo que es.
  const [inicialSemilla, setInicialSemilla] = useState<Record<string, string>>({});
  const [saldoReal, setSaldoReal] = useState<Record<string, string>>(
    Object.fromEntries(saldos.map((s) => [s.medio, s.real === null ? '' : String(Math.round(s.real))])),
  );
  // Qué cuenta está abierta mostrando su extracto.
  const [abierta, setAbierta] = useState<string | null>(null);
  // El saldo de VISA en positivo casi siempre es un signo invertido, y se paga caro: el
  // saldo de una tarjeta es una DEUDA. Cargado al revés, la caja del mes queda mal por el
  // doble del número y la diferencia aparece en otro lado. No se bloquea —puede haber un
  // saldo a favor— pero no se guarda sin preguntar.
  const [dudaSigno, setDudaSigno] = useState<{ medio: string; valor: number } | null>(null);

  async function llamar(body: any) {
    setOcupado(true); setError(null);
    try {
      const res = await fetch('/api/cuentas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      router.refresh();
      return true;
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar');
      return false;
    } finally { setOcupado(false); }
  }

  // El movimiento se guarda como un gasto de categoría "movimiento interno": es el mismo
  // registro que ya usaba la app, así que lo que se carga acá y lo que se cargó desde Gastos
  // son la misma cosa y no hay dos verdades.
  async function agregarMovimiento() {
    const m = Number(monto);
    if (!isFinite(m) || m <= 0) { setError('Ingresá un monto mayor a 0'); return; }
    if (origen === destino) { setError('La cuenta de origen y la de destino tienen que ser distintas.'); return; }
    // Una transferencia con fecha de otro mes no mueve los saldos del mes que se está
    // cerrando: se carga, desaparece de la lista y la conciliación sigue sin dar, sin que
    // nada diga por qué.
    if (fecha < primerDia || fecha > ultimoDia) {
      setError(`La fecha ${fecha.split('-').reverse().join('/')} no cae en el mes que estás cerrando. `
        + 'Un movimiento de otro mes no mueve estos saldos: cambiá la fecha, o cargalo desde el mes al que pertenece.');
      return;
    }
    setOcupado(true); setError(null);
    try {
      const res = await fetch('/api/gastos/nuevo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha, descripcion: notas || `${origen} → ${destino}`,
          categoria: 'movimiento_interno', monto: m,
          medio_pago: origen, medio_pago_destino: destino,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMonto(''); setNotas('');
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar el movimiento');
    } finally { setOcupado(false); }
  }

  async function borrarMovimiento(id: string) {
    if (!confirm('Se borra este movimiento entre cuentas. Los dos saldos vuelven a como estaban. ¿Confirmás?')) return;
    setOcupado(true); setError(null);
    try {
      const res = await fetch('/api/gastos/borrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: id }),
      });
      if (!res.ok) throw new Error('No se pudo borrar');
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'No se pudo borrar');
    } finally { setOcupado(false); }
  }

  // La diferencia se calcula con lo que hay ESCRITO en el campo, no con lo último que se
  // guardó. Antes venía del servidor: se tipeaba el saldo del resumen y la columna seguía
  // mostrando la diferencia vieja hasta que volvía el guardado — justo en el momento en que
  // uno mira si cerró, que es para lo único que sirve esa columna.
  function difDe(s: SaldoMes): number | null {
    const v = saldoReal[s.medio];
    if (v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    return n - s.calculado;
  }

  function guardarReal(s: SaldoMes) {
    const v = saldoReal[s.medio];
    if (v === '' || v === undefined) return;
    const n = Number(v);
    if (!isFinite(n)) return;
    if (s.real !== null && n === s.real) return;
    if (CUENTAS_DEUDA.includes(s.medio) && n > 0) { setDudaSigno({ medio: s.medio, valor: n }); return; }
    setDudaSigno(null);
    llamar({ accion: 'saldo_guardar', anio, mes, medio_pago: s.medio, saldo_real: n });
  }

  const totalMovido = movimientos.reduce((a, m) => a + (Number(m.monto) || 0), 0);
  const mesPrev = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  // Se muestran TODAS las cuentas aunque no hayan tenido movimiento: si solo aparecieran
  // las que se movieron, no habría dónde cargar el saldo real de las demás — y el primer
  // mes, que es justo cuando hay que sembrar los saldos iniciales, no aparecería casi
  // ninguna.
  const filas = saldos;

  return (
    <div>
      {error && <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#dc2626' }}>{error}</p>}

      {/* ── Movimientos entre cuentas ── */}
      <p style={{ margin: '0 0 6px', fontSize: '11.5px', color: '#6b7280' }}>
        Plata que pasa de una cuenta a otra: pagar el resumen de la tarjeta, una transferencia entre bancos, retirar
        efectivo. <strong>No es un gasto</strong> —la plata sigue siendo de la empresa— pero mueve los dos saldos.
        Las cobranzas no van acá: entran por la pantalla de Cobranzas.
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '10px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={ocupado}
            min={primerDia} max={ultimoDia}
            title="Tiene que ser una fecha del mes que estás cerrando"
            style={{
              fontSize: '12px', padding: '5px 7px', borderRadius: '5px',
              border: fecha < primerDia || fecha > ultimoDia ? '1px solid #dc2626' : '1px solid #e5e7eb',
            }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Sale de</label>
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} disabled={ocupado}
            style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }}>
            {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Entra a</label>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} disabled={ocupado}
            style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px', borderColor: origen === destino ? '#dc2626' : '#e5e7eb' }}>
            {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Monto</label>
          <input type="number" value={monto} onChange={(e) => setMonto(e.target.value)} min={0} step={1} disabled={ocupado} placeholder="0"
            style={{ width: '130px', textAlign: 'right', fontSize: '13px', fontWeight: 600, padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
        </div>
        <div style={{ flex: '1 1 140px', minWidth: '120px' }}>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Detalle</label>
          <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} disabled={ocupado} placeholder="Ej: pago resumen VISA"
            style={{ width: '100%', fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
        </div>
        <button onClick={agregarMovimiento} className="btn" disabled={ocupado} style={{ fontSize: '12px' }}>Agregar</button>
      </div>

      {movimientos.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id_gasto} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={{ ...cel, color: '#6b7280', width: '90px' }}>{String(m.fecha).split('-').reverse().join('/')}</td>
                <td style={cel}>
                  <strong>{m.origen}</strong> <span style={{ color: '#9ca3af' }}>→</span> <strong>{m.destino || '—'}</strong>
                </td>
                <td style={{ ...cel, color: '#9ca3af' }}>{m.descripcion}</td>
                <td style={{ ...celNum, fontWeight: 700 }}>{$(Number(m.monto) || 0)}</td>
                <td style={{ ...cel, width: '30px', textAlign: 'right' }}>
                  <button onClick={() => borrarMovimiento(m.id_gasto)} disabled={ocupado}
                    title="Borrar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '13px', padding: 0 }}>×</button>
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid #e5e7eb' }}>
              <td colSpan={3} style={{ ...cel, fontWeight: 700 }}>Total movido entre cuentas</td>
              <td style={{ ...celNum, fontWeight: 800 }}>{$(totalMovido)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}

      {/* ── Conciliación ── */}
      <p style={{ margin: '14px 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Saldos por cuenta
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
          <thead>
            <tr style={{ background: '#fafaf9' }}>
              {['Cuenta', 'Inicial', '+ Cobrado', '− Gastos', '± Entre cuentas', '= Saldo teórico', 'Real del resumen', 'Dif.'].map((h, i) => (
                <th key={h} style={{ ...cel, textAlign: i === 0 ? 'left' : 'right', fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.flatMap((s) => {
              const dif = difDe(s);
              const esta = abierta === s.medio;
              return [
                <tr key={s.medio} style={{ borderTop: '1px solid #f3f4f6', background: esta ? '#f8fafc' : undefined }}>
                  {/* Click en la cuenta = ver todo lo que la movió. Es lo que convierte
                      "faltan $899.500" en una tarea: sin el extracto hay que salir a la
                      planilla de Gastos, filtrar por medio de pago y comparar a mano. */}
                  <td style={{ ...cel, fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => setAbierta(esta ? null : s.medio)}
                    title="Ver todos los movimientos de esta cuenta en el mes">
                    <span style={{ color: '#9ca3af', fontSize: '10px', marginRight: '4px' }}>{esta ? '▾' : '▸'}</span>
                    {s.medio}
                    {!s.hayInicial && <span title="No hay saldo de cierre del mes anterior: el inicial arranca en cero" style={{ color: '#b45309', marginLeft: '4px' }}>·</span>}
                  </td>
                  <td style={{ ...cel, textAlign: 'right' }}>
                    <input type="number" value={inicialSemilla[s.medio] ?? (s.hayInicial ? String(Math.round(s.inicial)) : '')} step={1} disabled={ocupado}
                      onChange={(e) => setInicialSemilla((p) => ({ ...p, [s.medio]: e.target.value }))}
                      onBlur={() => {
                        const v = inicialSemilla[s.medio];
                        if (v === '' || v === undefined) return;
                        if (s.hayInicial && Number(v) === Math.round(s.inicial)) return;
                        llamar({ accion: 'saldo_guardar', anio: mesPrev.anio, mes: mesPrev.mes, medio_pago: s.medio, saldo_real: Number(v) });
                      }}
                      title={s.hayInicial
                        ? 'Es el cierre del mes anterior. Se puede corregir: lo que escribas acá se guarda como el saldo real de ese mes.'
                        : 'No hay cierre del mes anterior: cargá acá el saldo con el que arranca esta cuenta. Se guarda como el cierre del mes pasado.'}
                      placeholder={s.hayInicial ? '0' : 'sembrar'}
                      style={{
                        width: '110px', textAlign: 'right', fontSize: '12.5px', padding: '3px 6px', borderRadius: '4px',
                        border: s.hayInicial ? '1px solid #e5e7eb' : '1px dashed #b45309',
                        color: s.hayInicial ? '#6b7280' : '#111827',
                      }} />
                  </td>
                  <td style={{ ...celNum, color: s.cobranzas ? '#059669' : '#d1d5db' }}>{$(s.cobranzas)}</td>
                  <td style={{ ...celNum, color: s.gastos ? '#b45309' : '#d1d5db' }}>{$(s.gastos)}</td>
                  <td style={{ ...celNum, color: '#6b7280' }}>{$(s.entradas - s.salidas)}</td>
                  <td style={{ ...celNum, fontWeight: 700 }}>{$(s.calculado)}</td>
                  <td style={{ ...cel, textAlign: 'right' }}>
                    <input type="number" value={saldoReal[s.medio] ?? ''} step={1} disabled={ocupado}
                      onChange={(e) => setSaldoReal((p) => ({ ...p, [s.medio]: e.target.value }))}
                      onBlur={() => guardarReal(s)}
                      placeholder="—"
                      style={{
                        width: '110px', textAlign: 'right', fontSize: '12.5px', padding: '3px 6px', borderRadius: '4px',
                        border: dudaSigno?.medio === s.medio ? '1px solid #dc2626' : '1px solid #e5e7eb',
                      }} />
                  </td>
                  {/* La diferencia sale de lo que está ESCRITO, no de lo último guardado.
                      Antes se leía del servidor: se tipeaba el saldo del resumen y la
                      columna seguía mostrando la diferencia vieja hasta que el guardado
                      volvía — justo en el momento en que uno mira si cerró. */}
                  <td style={{ ...celNum, fontWeight: 800, color: dif === null ? '#d1d5db' : Math.abs(dif) < 1 ? '#059669' : '#dc2626' }}>
                    {dif === null ? '—' : Math.abs(dif) < 1 ? '✓' : $(dif)}
                  </td>
                </tr>,
                dudaSigno?.medio === s.medio ? (
                  <tr key={`${s.medio}-signo`}>
                    <td colSpan={8} style={{ padding: '0 8px 8px' }}>
                      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 11px', fontSize: '12px', color: '#991b1b' }}>
                        El saldo de <strong>{s.medio}</strong> es una <strong>deuda</strong>: va en negativo. Cargado en
                        positivo, la caja del mes queda mal por el doble del número y la diferencia aparece en otra cuenta.
                        <div style={{ display: 'flex', gap: '8px', marginTop: '7px', flexWrap: 'wrap' }}>
                          <button className="btn" style={{ fontSize: '11.5px' }} disabled={ocupado}
                            onClick={() => {
                              const v = -Math.abs(dudaSigno.valor);
                              setSaldoReal((p) => ({ ...p, [s.medio]: String(v) }));
                              setDudaSigno(null);
                              llamar({ accion: 'saldo_guardar', anio, mes, medio_pago: s.medio, saldo_real: v });
                            }}>
                            Guardar {$(-Math.abs(dudaSigno.valor))}
                          </button>
                          <button className="btn secondary" style={{ fontSize: '11.5px' }} disabled={ocupado}
                            onClick={() => {
                              const v = dudaSigno.valor;
                              setDudaSigno(null);
                              llamar({ accion: 'saldo_guardar', anio, mes, medio_pago: s.medio, saldo_real: v });
                            }}>
                            Es a favor, guardar {$(dudaSigno.valor)}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
                // ── El extracto de la cuenta ──────────────────────────────────────────
                abierta === s.medio ? (
                  <tr key={`${s.medio}-det`}>
                    <td colSpan={8} style={{ padding: '0 8px 10px' }}>
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: '7px', padding: '8px 10px', background: '#fcfcfb' }}>
                        <p style={{ margin: '0 0 6px', fontSize: '11.5px', color: '#6b7280' }}>
                          Todo lo que movió <strong>{s.medio}</strong> este mes, en orden. La suma da el saldo teórico:
                          lo que buscás es el movimiento que está en el resumen y no está acá, o el que está dos veces.
                        </p>
                        {(detalle[s.medio] || []).length === 0 ? (
                          <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>Esta cuenta no tuvo ningún movimiento registrado este mes.</p>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <tbody>
                              <tr style={{ color: '#9ca3af' }}>
                                <td style={{ padding: '2px 6px', width: '80px' }}>Inicial</td>
                                <td style={{ padding: '2px 6px' }} />
                                <td style={{ ...celNum, padding: '2px 6px' }} />
                                <td style={{ ...celNum, padding: '2px 6px', fontWeight: 700, color: '#6b7280' }}>{$(s.inicial)}</td>
                              </tr>
                              {(() => {
                                let acum = s.inicial;
                                return (detalle[s.medio] || []).map((m, i) => {
                                  acum += m.monto;
                                  return (
                                    <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                                      <td style={{ padding: '3px 6px', color: '#6b7280', whiteSpace: 'nowrap' }}>{String(m.fecha).split('-').reverse().join('/')}</td>
                                      <td style={{ padding: '3px 6px' }}>
                                        {m.descripcion}
                                        <span style={{ marginLeft: '6px', fontSize: '9.5px', fontWeight: 700, color: ETIQUETA[m.tipo].color }}>
                                          {ETIQUETA[m.tipo].texto}
                                        </span>
                                      </td>
                                      <td style={{ ...celNum, padding: '3px 6px', color: m.monto >= 0 ? '#059669' : '#b45309', fontWeight: 600 }}>
                                        {m.monto >= 0 ? '+' : ''}{$(m.monto)}
                                      </td>
                                      <td style={{ ...celNum, padding: '3px 6px', color: '#9ca3af' }}>{$(acum)}</td>
                                    </tr>
                                  );
                                });
                              })()}
                              <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                                <td style={{ padding: '4px 6px', fontWeight: 700 }} colSpan={3}>Saldo teórico</td>
                                <td style={{ ...celNum, padding: '4px 6px', fontWeight: 800 }}>{$(s.calculado)}</td>
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af', lineHeight: 1.5 }}>
        El saldo inicial de cada cuenta es el <strong>saldo real que cargaste el mes anterior</strong>, igual que el stock de insumos.
        La primera vez no existe: escribilo en la columna «Inicial» y queda guardado como el cierre del mes pasado.
        La diferencia contra el resumen es plata que se movió sin quedar registrada: mientras no dé ✓, falta cargar algo.
        Un movimiento entre cuentas no se cuenta como gasto — sale de una y entra en la otra.
        El <strong>cliente es opcional</strong>: para los saldos no hace falta, pero cada cobranza que lo lleve acerca a poder calcular deudores por venta acá en vez de en Xubio.
      </p>
    </div>
  );
}
