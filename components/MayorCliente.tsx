'use client';

import { useState } from 'react';
import type { LibroMayor, MovimientoMayor } from '@/lib/libroMayorCliente';

// ── La cuenta corriente, en orden ────────────────────────────────────────────────────
//
// La tabla de impagas dice cuánto debe el cliente. Esto contesta la pregunta que viene
// después, la que aparece cuando el cliente discute: cómo se llegó a ese número. Facturas
// y cobros en orden, con el saldo corriendo al lado.
//
// Se pide al abrirlo, no viene con la página: el detalle de todos los clientes es lo que
// hacía lenta esta pantalla, y un mayor se mira de a uno cuando hay algo que revisar.

const fmt = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString('es-AR');
const fmtFecha = (f: string) => {
  const [y, m, d] = String(f || '').split('-');
  return d ? `${d}/${m}` : f;
};

const COLOR: Record<string, string> = {
  factura: '#b45309',
  nota_credito: '#6d28d9',
  cobro: '#15803d',
  saldada: '#6b7280',
};

const ETIQUETA: Record<string, string> = {
  factura: 'Factura',
  nota_credito: 'Nota de crédito',
  cobro: 'Cobro',
  saldada: 'Saldada a mano',
};

export default function MayorCliente({ idControl, nombre, deuda }: {
  idControl: string;
  nombre: string;
  // Lo que dice la lista de facturas abiertas. Va solo para comparar: si los dos números
  // no coinciden hay que decirlo, no elegir uno.
  deuda?: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<LibroMayor | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    if (abierto) { setAbierto(false); return; }
    setAbierto(true);
    if (datos || cargando) return;
    setCargando(true); setError(null);
    try {
      const qs = new URLSearchParams({ id_control: idControl });
      if (deuda !== undefined) qs.set('deuda', String(Math.round(deuda)));
      const r = await fetch(`/api/cobranzas/mayor?${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'No se pudo armar el libro mayor');
      setDatos(j);
    } catch (e: any) {
      setError(e?.message || 'No se pudo armar el libro mayor');
    }
    setCargando(false);
  }

  return (
    <div style={{ marginTop: '10px' }}>
      <button
        type="button"
        className="btn secondary"
        style={{ fontSize: '12px', padding: '5px 12px' }}
        onClick={abrir}
      >
        {abierto ? '▲ Ocultar libro mayor' : '📒 Ver libro mayor'}
      </button>

      {abierto && (
        <div style={{ marginTop: '10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
          {cargando && <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>Buscando las facturas y los cobros de {nombre} en Xubio…</p>}
          {error && <p style={{ margin: 0, fontSize: '12px', color: '#dc2626' }}>{error}</p>}

          {datos && datos.movimientos.length === 0 && (
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
              No hay ni facturas ni cobros de {nombre} en los últimos {datos.desde ? '365 días' : 'meses mirados'}.
            </p>
          )}

          {datos && datos.movimientos.length > 0 && (
            <>
              <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#9ca3af' }}>
                Desde el {fmtFecha(datos.desde)} hasta el {fmtFecha(datos.hasta)} · {datos.movimientos.length} movimiento(s)
              </p>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ color: '#6b7280', textAlign: 'left' }}>
                      <th style={{ padding: '4px 6px', fontWeight: 600 }}>Fecha</th>
                      <th style={{ padding: '4px 6px', fontWeight: 600 }}>Movimiento</th>
                      <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Debe</th>
                      <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Haber</th>
                      <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.movimientos.map((m: MovimientoMayor, i: number) => (
                      <tr key={`${m.tipo}-${m.numero}-${i}`} style={{ borderTop: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '4px 6px', color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtFecha(m.fecha)}</td>
                        <td style={{ padding: '4px 6px' }}>
                          <span style={{ color: COLOR[m.tipo], fontWeight: 600 }}>{ETIQUETA[m.tipo]}</span>
                          {m.numero && <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#374151' }}> {m.numero}</span>}
                          {/* Lo que NO es plata se dice en la fila. Una factura dada por
                              saldada baja el saldo igual que un cobro, y sin esto se lee
                              como que el cliente pagó. */}
                          {!m.esPlata && (
                            <span style={{ marginLeft: '6px', fontSize: '10px', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '1px 6px' }}>
                              no es plata
                            </span>
                          )}
                          {m.nota && <div style={{ fontSize: '10.5px', color: '#9ca3af' }}>{m.nota}</div>}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', color: m.debe ? '#b45309' : '#d1d5db' }}>{m.debe ? fmt(m.debe) : '—'}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', color: m.haber ? '#15803d' : '#d1d5db' }}>{m.haber ? fmt(m.haber) : '—'}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {m.saldo < 0 ? `-${fmt(m.saldo)}` : fmt(m.saldo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                      <td colSpan={2} style={{ padding: '6px', fontWeight: 700 }}>
                        Saldo del período
                        <div style={{ fontSize: '10.5px', fontWeight: 400, color: '#9ca3af' }}>
                          Facturado {fmt(datos.totalFacturado)}
                          {datos.totalNotas ? ` · notas de crédito ${fmt(datos.totalNotas)}` : ''}
                          {' '}· cobrado {fmt(datos.totalCobrado)}
                          {datos.totalSaldadoAMano ? ` · dado por saldado ${fmt(datos.totalSaldadoAMano)}` : ''}
                        </div>
                      </td>
                      <td colSpan={2} />
                      <td style={{ padding: '6px', textAlign: 'right', fontWeight: 800, fontSize: '14px', whiteSpace: 'nowrap' }}>
                        {datos.saldo < 0 ? `-${fmt(datos.saldo)}` : fmt(datos.saldo)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {datos.saldo < 0 && (
                <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#15803d' }}>
                  Saldo a favor de {nombre}: en esta ventana pagó más de lo que se le facturó.
                </p>
              )}

              {/* Los dos números pueden no coincidir, y taparlo sería peor que mostrarlo:
                  el mayor existe justamente para poder discutir el otro número. */}
              {datos.diferencia.length > 0 && (
                <div style={{ marginTop: '10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '9px 11px' }}>
                  <p style={{ margin: '0 0 5px', fontSize: '12px', fontWeight: 700, color: '#92400e' }}>
                    El saldo del mayor ({datos.saldo < 0 ? '-' : ''}{fmt(datos.saldo)}) no coincide con la deuda abierta ({fmt(datos.deudaAbierta || 0)}).
                  </p>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '11.5px', color: '#92400e', lineHeight: 1.45 }}>
                    {datos.diferencia.map((d: string, i: number) => <li key={i}>{d}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
