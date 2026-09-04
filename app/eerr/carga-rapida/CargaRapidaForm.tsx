'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Grilla de conciliación: una celda por rubro × cuenta, más una lista de transferencias
// entre cuentas (incluido el pago de la tarjeta). Todo se guarda con un solo click, y cada
// celda o fila completada se convierte en un Gasto — exactamente como si se hubiera cargado
// a mano en /gastos, pero sin un formulario por línea.
//
// Las filas son las mismas 12 (costo variable) + 8 (costos fijos) del EERR, en su mismo
// orden — no una lista inventada. De las 12 de costo variable, 9 no tienen una categoría de
// Gasto propia: se calculan solas desde el consumo de Stocks, así que no llevan celda acá.

const clave = (cat: string, medio: string) => `${cat} ${medio}`;
const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

interface Transferencia { id: number; medio_pago: string; medio_pago_destino: string; monto: string; descripcion: string }
interface FilaGrilla { label: string; categoria: string | null }

export default function CargaRapidaForm({
  fechaSugerida, filasVariable, filasFijos, mediosGrilla, medios, consumoTarjetaMesPasado, yaHayPagoTarjeta, nombreMesPrev,
}: {
  fechaSugerida: string;
  filasVariable: FilaGrilla[];
  filasFijos: FilaGrilla[];
  mediosGrilla: readonly string[];  // solo los bancos: la grilla es para conciliar resúmenes
  medios: readonly string[];        // todas las cuentas: las transferencias pueden ir a cualquiera
  consumoTarjetaMesPasado: number;
  yaHayPagoTarjeta: boolean;
  nombreMesPrev: string;
}) {
  const router = useRouter();
  const [fecha, setFecha] = useState(fechaSugerida);
  const [celdas, setCeldas] = useState<Record<string, string>>({});
  const [transferencias, setTransferencias] = useState<Transferencia[]>([]);
  const [siguienteId, setSiguienteId] = useState(1);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function setCelda(cat: string, medio: string, val: string) {
    setCeldas((p) => ({ ...p, [clave(cat, medio)]: val }));
    setOk(null);
  }

  function agregarTransferencia(preset?: Partial<Transferencia>) {
    setTransferencias((p) => [...p, {
      id: siguienteId, medio_pago: medios[0], medio_pago_destino: medios[1] || medios[0],
      monto: '', descripcion: '', ...preset,
    }]);
    setSiguienteId((n) => n + 1);
    setOk(null);
  }

  function agregarPagoTarjeta() {
    agregarTransferencia({
      medio_pago: medios.find((m) => m !== 'VISA') || medios[0],
      medio_pago_destino: 'VISA',
      descripcion: `Pago tarjeta VISA — resumen de ${nombreMesPrev}`,
    });
  }

  function quitarTransferencia(id: number) {
    setTransferencias((p) => p.filter((t) => t.id !== id));
  }

  function actualizarTransferencia(id: number, campo: keyof Transferencia, val: string) {
    setTransferencias((p) => p.map((t) => (t.id === id ? { ...t, [campo]: val } : t)));
    setOk(null);
  }

  const celdasLlenas = Object.entries(celdas).filter(([, v]) => v !== '' && Number(v) !== 0);
  const transferenciasLlenas = transferencias.filter((t) => t.monto !== '' && Number(t.monto) !== 0);
  const totalACargar = celdasLlenas.length + transferenciasLlenas.length;

  async function guardar() {
    setError(null); setOk(null);
    if (totalACargar === 0) { setError('No hay nada cargado todavía.'); return; }
    for (const t of transferenciasLlenas) {
      if (t.medio_pago === t.medio_pago_destino) { setError('Una transferencia no puede tener el mismo origen y destino.'); return; }
    }
    setGuardando(true);
    try {
      const res = await fetch('/api/gastos/carga-rapida', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha,
          celdas: celdasLlenas.map(([k, v]) => {
            const [categoria, medio_pago] = k.split(' ');
            return { categoria, medio_pago, monto: Number(v) };
          }),
          transferencias: transferenciasLlenas.map((t) => ({
            medio_pago: t.medio_pago, medio_pago_destino: t.medio_pago_destino,
            monto: Number(t.monto), descripcion: t.descripcion,
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setOk(`${j.cargados} gasto(s) cargado(s).`);
      setCeldas({}); setTransferencias([]);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar');
    } finally { setGuardando(false); }
  }

  // Una sección de la grilla (Costo variable o Costos fijos). Las filas sin `categoria` no
  // tienen dónde escribir un Gasto — se calculan solas desde Stocks — así que se muestran
  // como referencia de una sola línea en vez de ocho celdas deshabilitadas que no llevan a
  // ningún lado.
  function Seccion({ titulo, filas }: { titulo: string; filas: FilaGrilla[] }) {
    return (
      <div style={{ marginBottom: '22px' }}>
        <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {titulo}
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: '#fafaf9', textAlign: 'left', padding: '6px 10px', fontSize: '10.5px', color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Rubro</th>
                {mediosGrilla.map((m) => (
                  <th key={m} style={{ padding: '6px 8px', fontSize: '10.5px', color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.label}>
                  <td style={{ position: 'sticky', left: 0, background: 'white', padding: '4px 10px', fontSize: '12.5px', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid #f3f4f6' }}>{fila.label}</td>
                  {fila.categoria === null ? (
                    <td colSpan={mediosGrilla.length} style={{ padding: '4px 10px', fontSize: '11px', color: '#9ca3af', fontStyle: 'italic', borderBottom: '1px solid #f3f4f6' }}>
                      se carga solo desde el consumo de Stocks, no acá
                    </td>
                  ) : mediosGrilla.map((m) => (
                    <td key={m} style={{ padding: '2px 4px', borderBottom: '1px solid #f3f4f6' }}>
                      <input type="number" step={1}
                        value={celdas[clave(fila.categoria!, m)] ?? ''}
                        onChange={(e) => setCelda(fila.categoria!, m, e.target.value)}
                        disabled={guardando}
                        placeholder="—"
                        style={{ width: '92px', textAlign: 'right', fontSize: '12px', padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: '4px' }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px' }}>
        <label style={{ fontSize: '12px', color: '#6b7280' }}>Fecha para todo lo que cargues acá</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={guardando}
          style={{ fontSize: '13px', padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: '6px' }} />
      </div>

      <Seccion titulo="Costo variable" filas={filasVariable} />
      <Seccion titulo="Costos fijos" filas={filasFijos} />

      {/* ── Transferencias ── */}
      <p id="transferencias" style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Transferencias entre cuentas
      </p>
      <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#6b7280' }}>
        Plata que sale de una cuenta y entra a otra — no es un gasto. Acá también va el pago del resumen de la tarjeta.
      </p>

      {!yaHayPagoTarjeta && (
        <button onClick={agregarPagoTarjeta} disabled={guardando} className="btn secondary" style={{ fontSize: '12px', marginBottom: '10px' }}>
          + Pago de la tarjeta ({nombreMesPrev}{consumoTarjetaMesPasado > 0 ? ` · se consumieron ${$(consumoTarjetaMesPasado)}` : ''})
        </button>
      )}
      {yaHayPagoTarjeta && (
        <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#059669' }}>✓ Ya hay un pago de tarjeta cargado este mes.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
        {transferencias.map((t) => (
          <div key={t.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={t.medio_pago} onChange={(e) => actualizarTransferencia(t.id, 'medio_pago', e.target.value)} disabled={guardando}
              style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }}>
              {medios.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>→</span>
            <select value={t.medio_pago_destino} onChange={(e) => actualizarTransferencia(t.id, 'medio_pago_destino', e.target.value)} disabled={guardando}
              style={{ fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }}>
              {medios.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="number" step={1} value={t.monto} onChange={(e) => actualizarTransferencia(t.id, 'monto', e.target.value)} disabled={guardando}
              placeholder="Monto" style={{ width: '120px', textAlign: 'right', fontSize: '12.5px', fontWeight: 600, padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
            <input type="text" value={t.descripcion} onChange={(e) => actualizarTransferencia(t.id, 'descripcion', e.target.value)} disabled={guardando}
              placeholder="Notas" style={{ flex: '1 1 160px', minWidth: '140px', fontSize: '12px', padding: '5px 7px', border: '1px solid #e5e7eb', borderRadius: '5px' }} />
            <button onClick={() => quitarTransferencia(t.id)} disabled={guardando}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '14px', padding: '0 4px' }}>×</button>
          </div>
        ))}
        <button onClick={() => agregarTransferencia()} disabled={guardando} className="btn secondary" style={{ fontSize: '12px', alignSelf: 'flex-start' }}>
          + Agregar transferencia
        </button>
      </div>

      {error && <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: '#dc2626' }}>{error}</p>}
      {ok && <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: '#059669', fontWeight: 600 }}>✓ {ok}</p>}

      <div style={{ marginTop: '16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        <button onClick={guardar} disabled={guardando || totalACargar === 0} className="btn" style={{ fontSize: '13px', fontWeight: 700 }}>
          {guardando ? 'Guardando…' : `Guardar ${totalACargar > 0 ? `(${totalACargar})` : ''}`}
        </button>
        {totalACargar === 0 && <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>Completá al menos una celda o transferencia.</span>}
      </div>
    </div>
  );
}
