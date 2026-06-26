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
  const [excluidas, setExcluidas] = useState<Set<string>>(new Set());
  const [quitando, setQuitando] = useState<string | null>(null);

  const incluidas = facturas.filter(f => !excluidas.has(f.id_control));
  const totalGeneral = incluidas.reduce((a, f) => a + f.total, 0);
  const totalUnidades = incluidas.reduce((a, f) => a + f.unidades, 0);
  const nA = incluidas.filter(f => f.letra === 'A').length;
  const nB = incluidas.filter(f => f.letra === 'B').length;

  function toggle(id: string) {
    setExcluidas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function quitar(id: string) {
    setQuitando(id); setErr(null);
    try {
      const r = await fetch('/api/facturacion/quitar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_control: id }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setQuitando(null); }
  }

  async function facturar() {
    setLoading(true); setErr(null); setResult(null);
    try {
      const idControls = incluidas.map(f => f.id_control);
      const r = await fetch('/api/facturacion/emitir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idControls }) });
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
          <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
            <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#1e40af' }}>📌 Último paso en Xubio (manual)</p>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#1e40af' }}>
              Las facturas ya están importadas. Entrá a <strong>Xubio → Comprobantes de venta</strong>, seleccionalas y apretá <strong>"Obtener CAE"</strong> (las A), y después <strong>"Enviar por correo"</strong>. La API de Xubio no permite hacer esos dos pasos automáticamente.
            </p>
          </div>
        )}
        {result.emitidas.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#166534', margin: '0 0 6px' }}>✓ Importadas a Xubio ({result.emitidas.length})</p>
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
          <strong>{incluidas.length}</strong> facturas a emitir
          {excluidas.size > 0 && <span style={{ color: '#9ca3af' }}> ({excluidas.size} sin tildar)</span>}
          <span style={{ color: '#9ca3af' }}> · {nA} A · {nB} B</span>
          <span style={{ marginLeft: '10px', fontSize: '14px', fontWeight: 700, color: '#374151' }}>{fmtU(totalUnidades)} u</span>
          <span style={{ marginLeft: '8px', fontSize: '16px', fontWeight: 800, color: '#111827' }}>{fmt(totalGeneral)}</span>
        </div>
        {!confirm
          ? <button className="btn" onClick={() => setConfirm(true)} disabled={loading || incluidas.length === 0}>📤 Facturar {incluidas.length} en Xubio</button>
          : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>¿Importar {incluidas.length} facturas a Xubio? El CAE se obtiene después en Xubio.</span>
              <button className="btn" onClick={facturar} disabled={loading}>{loading ? 'Emitiendo…' : 'Sí, facturar'}</button>
              <button className="btn secondary" onClick={() => setConfirm(false)} disabled={loading}>Cancelar</button>
            </div>
          )}
      </div>
      {err && <div className="alert-box error" style={{ marginBottom: '12px' }}>{err}</div>}

      {/* Lista de facturas pendientes */}
      {facturas.map(f => {
        const incluida = !excluidas.has(f.id_control);
        return (
        <div key={f.id_control} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden', opacity: incluida ? 1 : 0.5 }}>
          <div onClick={() => setOpen(o => ({ ...o, [f.id_control]: !o[f.id_control] }))}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer', background: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={incluida} onClick={e => e.stopPropagation()} onChange={() => toggle(f.id_control)}
                title="Incluir en la facturación" style={{ width: '17px', height: '17px', cursor: 'pointer' }} />
              <span style={{ fontSize: '11px', background: f.letra === 'A' ? '#dbeafe' : '#f3f4f6', color: f.letra === 'A' ? '#1e40af' : '#374151', padding: '1px 7px', borderRadius: '4px', fontWeight: 700 }}>Factura {f.letra}</span>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>{f.cliente}</span>
              <span style={{ fontSize: '11px', color: '#9ca3af' }}>{f.lineas.length} ítems</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#374151' }}>{fmtU(f.unidades)} u</span>
              <span style={{ fontSize: '15px', fontWeight: 800, color: '#111827' }}>{fmt(f.total)}</span>
              <button onClick={e => { e.stopPropagation(); quitar(f.id_control); }} disabled={quitando === f.id_control}
                title="Quitar de facturación (vuelve a borrador)"
                style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '5px', padding: '2px 7px', fontSize: '11px', cursor: 'pointer' }}>
                {quitando === f.id_control ? '…' : '✕'}
              </button>
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
        );
      })}
    </div>
  );
}
