'use client';
import { useState } from 'react';

interface ClienteOpt { id_control: string; nombre: string }
interface CobroFila {
  id_cobro: string; cliente: string; fecha: string; importe: number;
  numero_recibo: string; transaccionid: string; estado: string; observacion: string;
}

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};
const labelStyle: React.CSSProperties = { fontSize: '10.5px', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: '2px' };
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}/${y}` : '—'; };

// Diagnóstico + carga de cobros. El diagnóstico va primero a propósito: hasta no verlo en
// verde no se sabe si las credenciales y las cuentas están bien, y el primer cobro no es
// el momento de descubrirlo.
export default function RegistrarCobro({ clientes, cobros }: { clientes: ClienteOpt[]; cobros: CobroFila[] }) {
  const [diag, setDiag] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [cuentas, setCuentas] = useState<{ id: number; nombre: string }[]>([]);

  const [cliente, setCliente] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [importe, setImporte] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [observacion, setObservacion] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [filas, setFilas] = useState(cobros);

  async function correrDiagnostico() {
    setDiagLoading(true); setDiag(null);
    try {
      const r = await fetch('/api/cobranzas/diagnostico');
      const j = await r.json();
      setDiag(j);
      if (Array.isArray(j.cuentas)) setCuentas(j.cuentas);
    } catch (e: any) {
      setDiag({ ok: false, pasos: [{ paso: 'Conexión', ok: false, detalle: e.message || 'error' }] });
    }
    setDiagLoading(false);
  }

  async function registrar() {
    if (!cliente || !(Number(importe) > 0) || !cuentaId) {
      setMsg({ t: 'err', s: 'Completá cliente, importe y cuenta.' }); return;
    }
    const nombre = clientes.find((c) => c.id_control === cliente)?.nombre || '';
    const cuentaNom = cuentas.find((c) => String(c.id) === cuentaId)?.nombre || '';
    if (!confirm(`Se va a registrar en Xubio un cobro de $${Number(importe).toLocaleString('es-AR')} de ${nombre}, en ${cuentaNom}, con fecha ${fmtDia(fecha)}.\n\nEsto impacta en la contabilidad. ¿Confirmás?`)) return;

    setLoading(true); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/cobro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: cliente, fecha, importe: Number(importe), cuentaId: Number(cuentaId), observacion }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error al registrar');
      setMsg({ t: 'ok', s: `✓ Registrado en Xubio${j.numeroRecibo ? ` — recibo ${j.numeroRecibo}` : ''}. Recargando…` });
      setFilas((p) => [{
        id_cobro: j.id_cobro, cliente: nombre, fecha, importe: Number(importe),
        numero_recibo: j.numeroRecibo || '', transaccionid: String(j.transaccionid || ''),
        estado: 'registrado', observacion,
      }, ...p]);
      setTimeout(() => window.location.reload(), 1800);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al registrar' });
      setLoading(false);
    }
  }

  async function anular(c: CobroFila) {
    if (!confirm(`Se va a BORRAR de Xubio el cobro de ${c.cliente} por $${Number(c.importe).toLocaleString('es-AR')}. ¿Confirmás?`)) return;
    setLoading(true); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/cobro', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_cobro: c.id_cobro }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error al anular');
      setMsg({ t: 'ok', s: '✓ Anulado en Xubio. Recargando…' });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al anular' });
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
        <button onClick={correrDiagnostico} disabled={diagLoading}
          style={{ fontSize: '11.5px', padding: '5px 13px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
          {diagLoading ? 'Probando…' : '🔌 Probar conexión con Xubio'}
        </button>
        <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>No escribe nada — solo lee. Hay que correrlo antes del primer cobro para traer las cuentas.</span>
      </div>

      {diag && (
        <div style={{ marginBottom: '12px', fontSize: '12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px' }}>
          {(diag.pasos || []).map((p: any, i: number) => (
            <p key={i} style={{ margin: '0 0 3px', color: p.ok ? '#166534' : '#dc2626' }}>
              {p.ok ? '✓' : '✕'} <strong>{p.paso}</strong> — {p.detalle}
            </p>
          ))}
        </div>
      )}

      {cuentas.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '8px' }}>
            <div>
              <label style={labelStyle}>Cliente *</label>
              <select value={cliente} onChange={(e) => setCliente(e.target.value)} disabled={loading} style={inputStyle}>
                <option value="">— Elegir —</option>
                {clientes.map((c) => <option key={c.id_control} value={c.id_control}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha del cobro *</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={loading} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Importe *</label>
              <input type="number" min={1} value={importe} onChange={(e) => setImporte(e.target.value)} disabled={loading} style={inputStyle} placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>¿Dónde entró? *</label>
              <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} disabled={loading} style={inputStyle}>
                <option value="">— Elegir cuenta —</option>
                {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Observación (opcional)</label>
              <input value={observacion} onChange={(e) => setObservacion(e.target.value)} disabled={loading} style={inputStyle}
                placeholder="ej: transferencia del 12/09, cancela facturas de agosto" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={registrar} disabled={loading}
              style={{ fontSize: '11.5px', padding: '6px 14px', background: '#166534', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 700, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Registrando…' : 'Registrar cobro en Xubio'}
            </button>
            {msg && <span style={{ fontSize: '11.5px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</span>}
          </div>
        </>
      )}

      {filas.length > 0 && (
        <div style={{ marginTop: '14px', overflowX: 'auto' }}>
          <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Cobros registrados desde la app</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '520px' }}>
            <thead>
              <tr style={{ background: '#f9fafb', color: '#6b7280' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Importe</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Recibo</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id_cobro} style={{ borderTop: '1px solid #f3f4f6', opacity: c.estado === 'anulado' ? 0.45 : 1 }}>
                  <td style={{ padding: '6px 8px', color: '#6b7280' }}>{fmtDia(c.fecha)}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600, textDecoration: c.estado === 'anulado' ? 'line-through' : 'none' }}>{c.cliente}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>${Number(c.importe).toLocaleString('es-AR')}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '11px' }}>{c.numero_recibo || '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {c.estado === 'anulado'
                      ? <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>anulado</span>
                      : <button onClick={() => anular(c)} disabled={loading}
                          style={{ fontSize: '10.5px', padding: '3px 9px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
                          Anular
                        </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
