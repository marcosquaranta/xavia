'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DeudaProveedor } from '@/lib/proveedores';

// ── Cuánto le debemos a cada proveedor ───────────────────────────────────────────────
//
// Las compras cargadas como pendientes, agrupadas por proveedor y ordenadas por lo que
// vence antes — que es el orden en el que hay que pagar.
//
// Marcar pagada acá no es un cambio de estado cosmético: le pone al gasto la fecha real del
// pago y el medio por el que salió, y recién ahí entra en el resultado del mes. Si se
// dejara la fecha de la compra, un pago de octubre caería en el resultado de septiembre.

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDia = (f: string) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : '—'; };
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

export default function DeudaProveedores({ deuda, medios }: { deuda: DeudaProveedor[]; medios: string[] }) {
  const router = useRouter();
  const [pagando, setPagando] = useState<string | null>(null);
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [medio, setMedio] = useState(medios[0] || '');
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const total = deuda.reduce((a, d) => a + d.total, 0);
  const vencido = deuda.reduce((a, d) => a + d.vencido, 0);

  async function pagar(id: string) {
    setTrabajando(true); setMsg(null);
    try {
      const r = await fetch('/api/gastos/pagar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_gasto: id, fecha_pago: fechaPago, medio_pago: medio }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'No se pudo marcar como pagada.');
      setMsg({ ok: true, texto: '✓ Marcada como pagada.' });
      setPagando(null);
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo marcar como pagada.' });
    } finally {
      setTrabajando(false);
    }
  }

  if (!deuda.length) {
    return <p style={{ margin: 0, fontSize: '13px', color: '#059669' }}>No hay compras pendientes de pago.</p>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <div>
          <p style={{ margin: 0, fontSize: '10.5px', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Se debe</p>
          <strong style={{ fontSize: '20px' }}>{fmt$(total)}</strong>
        </div>
        {vencido > 0 && (
          <div>
            <p style={{ margin: 0, fontSize: '10.5px', color: '#991b1b', textTransform: 'uppercase', fontWeight: 700 }}>Ya vencido</p>
            <strong style={{ fontSize: '20px', color: '#dc2626' }}>{fmt$(vencido)}</strong>
          </div>
        )}
      </div>

      {deuda.map((d) => (
        <div key={d.proveedor} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px' }}>
            <strong style={{ fontSize: '13.5px' }}>{d.proveedor}</strong>
            <span style={{ fontSize: '13.5px', fontWeight: 700 }}>
              {fmt$(d.total)}
              {d.vencido > 0 && <span style={{ color: '#dc2626', fontWeight: 600, fontSize: '11.5px' }}> · {fmt$(d.vencido)} vencido</span>}
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', marginTop: '4px' }}>
            <tbody>
              {d.items.map((i) => {
                const vencidoItem = i.diasParaVencer !== null && i.diasParaVencer < 0;
                return (
                  <tr key={i.id_gasto} style={{ borderTop: '1px solid #f9fafb' }}>
                    <td style={{ padding: '3px 6px', color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDia(i.fecha)}</td>
                    <td style={{ padding: '3px 6px' }}>{i.descripcion}</td>
                    <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', color: vencidoItem ? '#dc2626' : '#6b7280', fontWeight: vencidoItem ? 700 : 400 }}>
                      {!i.vencimiento ? <span style={{ color: '#b45309' }}>sin vencimiento</span>
                        : vencidoItem ? `venció hace ${Math.abs(i.diasParaVencer!)} d`
                        : i.diasParaVencer === 0 ? 'vence hoy'
                        : `en ${i.diasParaVencer} d`}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt$(i.monto)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {pagando === i.id_gasto ? (
                        <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)}
                            style={{ fontSize: '11px' }} title="Fecha real del pago" />
                          <select value={medio} onChange={(e) => setMedio(e.target.value)} style={{ fontSize: '11px' }} title="De dónde sale la plata">
                            {medios.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <button type="button" className="btn" style={{ fontSize: '10.5px', padding: '2px 8px' }}
                            onClick={() => pagar(i.id_gasto)} disabled={trabajando || !medio}>
                            {trabajando ? '…' : 'Confirmar'}
                          </button>
                          <button type="button" onClick={() => setPagando(null)} disabled={trabajando}
                            style={{ background: 'none', border: 'none', fontSize: '10.5px', color: '#6b7280', cursor: 'pointer' }}>✕</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => { setPagando(i.id_gasto); setFechaPago(hoyISO()); setMsg(null); }}
                          style={{ fontSize: '10.5px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: '4px', padding: '2px 9px', cursor: 'pointer', fontWeight: 600 }}>
                          Pagar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {msg && <p style={{ margin: '8px 0 0', fontSize: '12.5px', fontWeight: 600, color: msg.ok ? '#059669' : '#dc2626' }}>{msg.texto}</p>}

      <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: '#9ca3af', lineHeight: 1.5 }}>
        Estas compras todavía no cuentan como gasto: la plata no salió. Al marcarlas pagadas se les pone la fecha
        real del pago y recién ahí entran en el resultado del mes.
      </p>
    </div>
  );
}
