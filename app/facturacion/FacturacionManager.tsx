'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Linea { producto: string; sucursal: string; cantidad: number; precio: number; importe: number; }
interface FacturaPendiente { id_control: string; cliente: string; letra: string; fecha: string; lineas: Linea[]; unidades: number; total: number; }

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtU = (n: number) => Math.round(n).toLocaleString('es-AR');

export default function FacturacionManager({ facturas }: { facturas: FacturaPendiente[] }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ emitidas: any[]; errores: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const totalGeneral = facturas.reduce((a, f) => a + f.total, 0);
  const totalUnidades = facturas.reduce((a, f) => a + f.unidades, 0);
  const nA = facturas.filter(f => f.letra === 'A').length;
  const nB = facturas.filter(f => f.letra === 'B').length;

  async function facturar() {
    setLoading(true); setErr(null); setResult(null);
    try {
      const r = await fetch('/api/facturacion/emitir', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      setResult({ emitidas: j.emitidas || [], errores: j.errores || [] });
      setConfirm(false);
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }

  if (result) {
    return (
      <div>
        <p className="card-title">Resultado de la facturación</p>
        {result.emitidas.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#166534', margin: '0 0 6px' }}>✓ Emitidas ({result.emitidas.length})</p>
            {result.emitidas.map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '5px 10px', background: '#f0fdf4', borderRadius: '6px', marginBottom: '4px' }}>
                <span>{e.cliente}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{e.numero}{e.cae ? ` · CAE ${e.cae}` : ''}</span>
              </div>
            ))}
          </div>
        )}
        {result.errores.length > 0 && (
          <div>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#dc2626', margin: '0 0 6px' }}>✗ Con error ({result.errores.length}) — quedan pendientes</p>
            {result.errores.map((e, i) => (
              <div key={i} style={{ fontSize: '13px', padding: '5px 10px', background: '#fef2f2', borderRadius: '6px', marginBottom: '4px' }}>
                <strong>{e.cliente}:</strong> {e.error}
              </div>
            ))}
          </div>
        )}
        <button className="btn secondary" style={{ marginTop: '12px' }} onClick={() => { setResult(null); router.refresh(); }}>Volver</button>
      </div>
    );
  }

  if (!facturas.length) {
    return <p style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', padding: '30px' }}>No hay ventas cargadas pendientes de facturar. Cargá ventas desde la sección Ventas.</p>;
  }

  return (
    <div>
      {/* Resumen + acción */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '14px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px' }}>
        <div style={{ fontSize: '13px', color: '#374151' }}>
          <strong>{facturas.length}</strong> facturas a emitir
          <span style={{ color: '#9ca3af' }}> · {nA} A · {nB} B</span>
          <span style={{ marginLeft: '10px', fontSize: '14px', fontWeight: 700, color: '#374151' }}>{fmtU(totalUnidades)} u</span>
          <span style={{ marginLeft: '8px', fontSize: '16px', fontWeight: 800, color: '#111827' }}>{fmt(totalGeneral)}</span>
        </div>
        {!confirm
          ? <button className="btn" onClick={() => setConfirm(true)} disabled={loading}>📤 Facturar en Xubio</button>
          : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>¿Emitir {facturas.length} facturas? Las A salen con CAE.</span>
              <button className="btn" onClick={facturar} disabled={loading}>{loading ? 'Emitiendo…' : 'Sí, facturar'}</button>
              <button className="btn secondary" onClick={() => setConfirm(false)} disabled={loading}>Cancelar</button>
            </div>
          )}
      </div>
      {err && <div className="alert-box error" style={{ marginBottom: '12px' }}>{err}</div>}

      {/* Lista de facturas pendientes */}
      {facturas.map(f => (
        <div key={f.id_control} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
          <div onClick={() => setOpen(o => ({ ...o, [f.id_control]: !o[f.id_control] }))}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer', background: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', background: f.letra === 'A' ? '#dbeafe' : '#f3f4f6', color: f.letra === 'A' ? '#1e40af' : '#374151', padding: '1px 7px', borderRadius: '4px', fontWeight: 700 }}>Factura {f.letra}</span>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>{f.cliente}</span>
              <span style={{ fontSize: '11px', color: '#9ca3af' }}>{f.lineas.length} ítems</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#374151' }}>{fmtU(f.unidades)} u</span>
              <span style={{ fontSize: '15px', fontWeight: 800, color: '#111827' }}>{fmt(f.total)}</span>
              <span style={{ fontSize: '11px', color: '#9ca3af' }}>{open[f.id_control] ? '▲' : '▼'}</span>
            </div>
          </div>
          {open[f.id_control] && (
            <table style={{ width: '100%', fontSize: '12px', borderTop: '1px solid #f3f4f6' }}>
              <thead><tr style={{ background: '#fafafa', color: '#6b7280' }}>
                <th style={{ textAlign: 'left', padding: '6px 14px' }}>Producto</th>
                <th style={{ textAlign: 'left', padding: '6px' }}>Sucursal</th>
                <th style={{ textAlign: 'right', padding: '6px' }}>Cant.</th>
                <th style={{ textAlign: 'right', padding: '6px' }}>Precio</th>
                <th style={{ textAlign: 'right', padding: '6px 14px' }}>Importe</th>
              </tr></thead>
              <tbody>
                {f.lineas.map((l, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f9fafb' }}>
                    <td style={{ padding: '5px 14px' }}>{l.producto}</td>
                    <td style={{ padding: '5px', color: '#6b7280' }}>{l.sucursal}</td>
                    <td style={{ padding: '5px', textAlign: 'right' }}>{l.cantidad}</td>
                    <td style={{ padding: '5px', textAlign: 'right', color: '#6b7280' }}>{fmt(l.precio)}</td>
                    <td style={{ padding: '5px 14px', textAlign: 'right', fontWeight: 600 }}>{fmt(l.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
