'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MEDIOS_PAGO } from '@/lib/types';
import type { Cobranza, SaldoMes } from '@/lib/cuentas';

// Cobranzas del mes y conciliación de cada cuenta. La diferencia entre el saldo calculado y
// el del resumen es plata que se movió sin quedar registrada: mientras no sea cero, falta
// cargar algo. Es el mismo control que hoy se hace a mano contra Xubio.

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const cel: React.CSSProperties = { padding: '5px 8px', fontSize: '12.5px' };
const celNum: React.CSSProperties = { ...cel, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export default function CuentasEditor({ anio, mes, cobranzas, saldos }: {
  anio: number; mes: number; cobranzas: Cobranza[]; saldos: SaldoMes[];
}) {
  const router = useRouter();
  const [fecha, setFecha] = useState(`${anio}-${String(mes).padStart(2, '0')}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`);
  const [medio, setMedio] = useState<string>(MEDIOS_PAGO[0]);
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saldoReal, setSaldoReal] = useState<Record<string, string>>(
    Object.fromEntries(saldos.map((s) => [s.medio, s.real === null ? '' : String(Math.round(s.real))])),
  );

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

  async function agregar() {
    const m = Number(monto);
    if (!isFinite(m) || m <= 0) { setError('Ingresá un monto mayor a 0'); return; }
    if (await llamar({ accion: 'cobranza_nueva', fecha, medio_pago: medio, monto: m, notas })) {
      setMonto(''); setNotas('');
    }
  }

  const totalCobrado = cobranzas.reduce((a, c) => a + (Number(c.monto) || 0), 0);
  // Se muestran TODAS las cuentas aunque no hayan tenido movimiento: si solo aparecieran
  // las que se movieron, no habría dónde cargar el saldo real de las demás — y el primer
  // mes, que es justo cuando hay que sembrar los saldos iniciales, no aparecería casi
  // ninguna.
  const filas = saldos;

  return (
    <div>
      {error && <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#dc2626' }}>{error}</p>}

      {/* ── Cobranzas ── */}
      <p style={{ margin: '0 0 6px', fontSize: '11.5px', color: '#6b7280' }}>
        Cargá el total cobrado por cuenta. Podés poner una línea por cuenta al cerrar el mes, o ir sumándolas durante el mes: lo que importa es el total por cuenta.
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '10px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={ocupado}
            style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Entra a</label>
          <select value={medio} onChange={(e) => setMedio(e.target.value)} disabled={ocupado}
            style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }}>
            {MEDIOS_PAGO.filter((m) => m !== 'Aporte socios').map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Monto cobrado</label>
          <input type="number" value={monto} onChange={(e) => setMonto(e.target.value)} min={0} step={1} disabled={ocupado} placeholder="0"
            style={{ width: '130px', textAlign: 'right', fontSize: '13px', fontWeight: 600, padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
        </div>
        <div style={{ flex: '1 1 160px', minWidth: '140px' }}>
          <label style={{ display: 'block', fontSize: '10.5px', color: '#6b7280' }}>Notas</label>
          <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} disabled={ocupado} placeholder="Ej: cobranzas de la semana"
            style={{ width: '100%', fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
        </div>
        <button onClick={agregar} className="btn" disabled={ocupado} style={{ fontSize: '12px' }}>Agregar</button>
      </div>

      {cobranzas.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
          <tbody>
            {cobranzas.map((c) => (
              <tr key={c.id_cobranza} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={{ ...cel, color: '#6b7280', width: '90px' }}>{String(c.fecha).split('-').reverse().join('/')}</td>
                <td style={cel}>{c.medio_pago}</td>
                <td style={{ ...cel, color: '#9ca3af' }}>{c.notas}</td>
                <td style={{ ...celNum, fontWeight: 700 }}>{$(Number(c.monto) || 0)}</td>
                <td style={{ ...cel, width: '30px', textAlign: 'right' }}>
                  <button onClick={() => llamar({ accion: 'cobranza_borrar', id_cobranza: c.id_cobranza })} disabled={ocupado}
                    title="Borrar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '13px', padding: 0 }}>×</button>
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid #e5e7eb' }}>
              <td colSpan={3} style={{ ...cel, fontWeight: 700 }}>Total cobrado</td>
              <td style={{ ...celNum, fontWeight: 800 }}>{$(totalCobrado)}</td>
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
              {['Cuenta', 'Inicial', '+ Cobrado', '− Gastos', '± Entre cuentas', '= Calculado', 'Real del resumen', 'Dif.'].map((h, i) => (
                <th key={h} style={{ ...cel, textAlign: i === 0 ? 'left' : 'right', fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((s) => {
              const dif = s.diferencia;
              return (
                <tr key={s.medio} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ ...cel, fontWeight: 600 }}>
                    {s.medio}
                    {!s.hayInicial && <span title="No hay saldo de cierre del mes anterior: el inicial arranca en cero" style={{ color: '#b45309', marginLeft: '4px' }}>·</span>}
                  </td>
                  <td style={{ ...celNum, color: '#9ca3af' }}>{$(s.inicial)}</td>
                  <td style={{ ...celNum, color: s.cobranzas ? '#059669' : '#d1d5db' }}>{$(s.cobranzas)}</td>
                  <td style={{ ...celNum, color: s.gastos ? '#b45309' : '#d1d5db' }}>{$(s.gastos)}</td>
                  <td style={{ ...celNum, color: '#6b7280' }}>{$(s.entradas - s.salidas)}</td>
                  <td style={{ ...celNum, fontWeight: 700 }}>{$(s.calculado)}</td>
                  <td style={{ ...cel, textAlign: 'right' }}>
                    <input type="number" value={saldoReal[s.medio] ?? ''} step={1} disabled={ocupado}
                      onChange={(e) => setSaldoReal((p) => ({ ...p, [s.medio]: e.target.value }))}
                      onBlur={() => {
                        const v = saldoReal[s.medio];
                        if (v === '' || v === undefined) return;
                        if (s.real !== null && Number(v) === s.real) return;
                        llamar({ accion: 'saldo_guardar', anio, mes, medio_pago: s.medio, saldo_real: Number(v) });
                      }}
                      placeholder="—"
                      style={{ width: '110px', textAlign: 'right', fontSize: '12.5px', padding: '3px 6px', border: '1px solid #e5e7eb', borderRadius: '4px' }} />
                  </td>
                  <td style={{ ...celNum, fontWeight: 800, color: dif === null ? '#d1d5db' : Math.abs(dif) < 1 ? '#059669' : '#dc2626' }}>
                    {dif === null ? '—' : Math.abs(dif) < 1 ? '✓' : $(dif)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af', lineHeight: 1.5 }}>
        El saldo inicial de cada cuenta es el <strong>saldo real que cargaste el mes anterior</strong>, igual que el stock de insumos.
        La diferencia contra el resumen es plata que se movió sin quedar registrada: mientras no dé ✓, falta cargar algo.
        Un movimiento entre cuentas no se cuenta como gasto — sale de una y entra en la otra.
      </p>
    </div>
  );
}
