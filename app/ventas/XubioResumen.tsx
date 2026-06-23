'use client';
import { useState } from 'react';

interface UltimoNumeroPV { pv: string; letra: string; numeroCompleto: string; numero: number; }
interface VentaMes { mes: string; total: number; cantidad: number; }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtMes(m: string) { const [y, mo] = m.split('-'); return `${MESES[Number(mo) - 1]} ${y.slice(2)}`; }
function fmtPesos(n: number) { return '$' + Math.round(n).toLocaleString('es-AR'); }

export default function XubioResumen() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<{ ultimos: UltimoNumeroPV[]; mensuales: VentaMes[] } | null>(null);

  async function cargar() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/xubio/resumen');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setData(j);
    } catch (e: any) { setErr(e.message || 'Error consultando Xubio'); }
    finally { setLoading(false); }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) cargar();
  }

  const maxVenta = data ? Math.max(...data.mensuales.map(m => m.total), 1) : 1;

  return (
    <div style={{ marginTop: '14px', borderTop: '1px solid #f3f4f6', paddingTop: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={toggle}
          style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', color: '#374151', fontWeight: 600 }}>
          {open ? '▲' : '▼'} 📊 Resumen Xubio · último N° por PV y ventas mensuales
        </button>
        {open && data && !loading && (
          <button onClick={cargar} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: '#3b82f6' }}>↻ actualizar</button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: '12px' }}>
          {loading && <p style={{ fontSize: '13px', color: '#9ca3af', padding: '8px 0' }}>Consultando Xubio…</p>}
          {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: '#dc2626' }}>{err}</div>}

          {data && !loading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2fr', gap: '14px', alignItems: 'start' }}>
              {/* Último número por PV */}
              <div>
                <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>Último N° emitido</p>
                {data.ultimos.length === 0
                  ? <p style={{ fontSize: '12px', color: '#9ca3af' }}>Sin comprobantes.</p>
                  : data.ultimos.map(u => (
                    <div key={u.numeroCompleto} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', border: '1px solid #e5e7eb', borderRadius: '7px', padding: '8px 12px', marginBottom: '6px' }}>
                      <div>
                        <span style={{ fontSize: '11px', background: u.letra === 'A' ? '#dbeafe' : '#f3f4f6', color: u.letra === 'A' ? '#1e40af' : '#374151', padding: '1px 7px', borderRadius: '4px', fontWeight: 700 }}>Factura {u.letra}</span>
                        <span style={{ marginLeft: '6px', fontSize: '11px', color: '#6b7280' }}>PV {u.pv}</span>
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 800, color: '#111827' }}>{u.numeroCompleto}</span>
                    </div>
                  ))}
              </div>

              {/* Ventas mensuales $ */}
              <div>
                <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>Ventas mensuales (facturado en Xubio)</p>
                {[...data.mensuales].reverse().map(m => (
                  <div key={m.mes} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                    <span style={{ width: '52px', fontSize: '11px', color: '#6b7280', textTransform: 'capitalize' }}>{fmtMes(m.mes)}</span>
                    <div style={{ flex: 1, background: '#f3f4f6', borderRadius: '4px', height: '20px', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(2, (m.total / maxVenta) * 100)}%`, background: 'linear-gradient(90deg,#16a34a,#22c55e)', height: '100%', borderRadius: '4px' }} />
                    </div>
                    <span style={{ width: '110px', textAlign: 'right', fontSize: '13px', fontWeight: 700, color: '#166534' }}>{fmtPesos(m.total)}</span>
                    <span style={{ width: '60px', textAlign: 'right', fontSize: '10px', color: '#9ca3af' }}>{m.cantidad} fact.</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
