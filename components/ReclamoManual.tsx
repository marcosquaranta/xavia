'use client';
import { useState } from 'react';

interface ClienteOpt { id_control: string; nombre: string }
interface Factura {
  numero: string; fecha: string; importe: number;
  yaCobrada: boolean; reclamadaEl: string;
}

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};
const labelStyle: React.CSSProperties = { fontSize: '10.5px', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: '2px' };
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}/${y}` : '—'; };
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const diasDesde = (f: string) => Math.round((Date.now() - new Date(f + 'T12:00:00').getTime()) / 86400000);

// Reclamo puntual, aparte del automático. La idea es no tener que tocar la configuración
// de las alertas semanales para mandar algo una sola vez: se elige el cliente, se marca
// desde qué fecha (o se tildan las facturas una por una) y se manda.
export default function ReclamoManual({ clientes }: { clientes: ClienteOpt[] }) {
  const [cliente, setCliente] = useState('');
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [desde, setDesde] = useState('');
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  async function cambiarCliente(id: string) {
    setCliente(id); setFacturas([]); setElegidas([]); setDesde(''); setMsg(null);
    if (!id) return;
    setCargando(true);
    try {
      const r = await fetch(`/api/cobranzas/facturas?id_control=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No se pudieron traer las facturas');
      setFacturas(j.facturas || []);
      if (!(j.facturas || []).length) setMsg({ t: 'err', s: 'Ese cliente no tiene facturas en los últimos 120 días.' });
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'No se pudieron traer las facturas' });
    }
    setCargando(false);
  }

  // "Desde esta fecha en adelante": tilda de una todas las facturas de esa fecha o
  // posteriores. Es el caso que se quiere el 90% de las veces; después se puede destildar
  // alguna suelta si hace falta.
  function aplicarDesde(fecha: string) {
    setDesde(fecha);
    if (!fecha) { setElegidas([]); return; }
    setElegidas(facturas.filter((f) => f.fecha >= fecha).map((f) => f.numero));
  }

  function toggle(numero: string) {
    setElegidas((p) => p.includes(numero) ? p.filter((n) => n !== numero) : [...p, numero]);
  }

  const seleccionadas = facturas.filter((f) => elegidas.includes(f.numero));
  const total = seleccionadas.reduce((a, f) => a + f.importe, 0);
  const yaReclamadas = seleccionadas.filter((f) => f.reclamadaEl).length;
  const yaCobradas = seleccionadas.filter((f) => f.yaCobrada).length;
  const nombreCliente = clientes.find((c) => c.id_control === cliente)?.nombre || '';

  async function enviar() {
    if (!seleccionadas.length) { setMsg({ t: 'err', s: 'Elegí al menos una factura.' }); return; }
    const aviso = `Se le va a mandar un reclamo a ${nombreCliente} AHORA.\n\n`
      + `${seleccionadas.length} comprobante(s) · ${fmt$(total)}\n`
      + `${seleccionadas.slice(0, 6).map((f) => `  ${f.numero} · ${fmtDia(f.fecha)} · ${fmt$(f.importe)}`).join('\n')}`
      + (seleccionadas.length > 6 ? `\n  …y ${seleccionadas.length - 6} más` : '')
      + (yaCobradas > 0 ? `\n\nOJO: ${yaCobradas} ya figura(n) como cobrada(s) en la app.` : '')
      + (yaReclamadas > 0 ? `\n\n${yaReclamadas} ya se había(n) reclamado antes.` : '')
      + '\n\nEl mail sale al cliente con copia a administración. ¿Confirmás?';
    if (!confirm(aviso)) return;

    setEnviando(true); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/reclamo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: cliente, facturas: seleccionadas.map((f) => ({ numero: f.numero, fecha: f.fecha, importe: f.importe })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo enviar');
      setMsg({ t: 'ok', s: `✓ Reclamo enviado a ${j.enviadoA} — ${j.cantidad} comprobante(s) por ${fmt$(j.total || total)}` });
      // Se recargan las facturas para que queden marcadas como reclamadas recién ahora.
      await cambiarCliente(cliente);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'No se pudo enviar' });
    }
    setEnviando(false);
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '8px' }}>
        <div>
          <label style={labelStyle}>Cliente *</label>
          <select value={cliente} onChange={(e) => cambiarCliente(e.target.value)} disabled={enviando} style={inputStyle}>
            <option value="">— Elegir —</option>
            {clientes.map((c) => <option key={c.id_control} value={c.id_control}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Reclamar desde esta fecha</label>
          <input type="date" value={desde} onChange={(e) => aplicarDesde(e.target.value)} disabled={enviando || !facturas.length} style={inputStyle} />
          <span style={{ fontSize: '10px', color: '#9ca3af' }}>Tilda todas las facturas de esa fecha en adelante</span>
        </div>
      </div>

      {cargando && <p style={{ margin: '10px 0 0', fontSize: '11.5px', color: '#6b7280' }}>Buscando facturas…</p>}

      {facturas.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#374151' }}>Facturas de {nombreCliente}</span>
            <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>últimos 120 días</span>
            <button onClick={() => { setElegidas(facturas.map((f) => f.numero)); setDesde(''); }} disabled={enviando}
              style={{ fontSize: '10.5px', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
              tildar todas
            </button>
            <button onClick={() => { setElegidas([]); setDesde(''); }} disabled={enviando}
              style={{ fontSize: '10.5px', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 0 }}>
              limpiar
            </button>
            {elegidas.length > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: '#166534' }}>
                {elegidas.length} tildada{elegidas.length > 1 ? 's' : ''} · {fmt$(total)}
              </span>
            )}
          </div>

          <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
            {facturas.map((f) => {
              const tildada = elegidas.includes(f.numero);
              return (
                <label key={f.numero}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 9px',
                    borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: '12px',
                    background: tildada ? '#f0fdf4' : 'white',
                  }}>
                  <input type="checkbox" checked={tildada} disabled={enviando} onChange={() => toggle(f.numero)} />
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#1d4ed8', minWidth: '132px' }}>{f.numero}</span>
                  <span style={{ color: '#6b7280', minWidth: '78px' }}>{fmtDia(f.fecha)}</span>
                  <span style={{ color: '#9ca3af', fontSize: '10.5px', minWidth: '46px' }}>{diasDesde(f.fecha)}d</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmt$(f.importe)}</span>
                  {f.reclamadaEl && (
                    <span title={`Se reclamó el ${fmtDia(f.reclamadaEl)}`} style={{ fontSize: '9.5px', background: '#fffbeb', color: '#92400e', padding: '1px 6px', borderRadius: '8px', fontWeight: 700 }}>
                      reclamada {fmtDia(f.reclamadaEl).slice(0, 5)}
                    </span>
                  )}
                  {f.yaCobrada && (
                    <span title="Ya entró en un cobro registrado desde la app" style={{ fontSize: '9.5px', background: '#f0fdf4', color: '#166534', padding: '1px 6px', borderRadius: '8px', fontWeight: 700 }}>
                      cobrada
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {yaCobradas > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#b45309' }}>
              ⚠ {yaCobradas} de las tildadas ya figura(n) como cobrada(s) en la app. Revisá antes de mandar.
            </p>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={enviar} disabled={enviando || !elegidas.length}
              style={{
                fontSize: '11.5px', padding: '6px 14px', background: elegidas.length ? '#b45309' : '#e5e7eb',
                color: elegidas.length ? 'white' : '#9ca3af', border: 'none', borderRadius: '5px',
                cursor: elegidas.length ? 'pointer' : 'default', fontWeight: 700,
              }}>
              {enviando ? 'Enviando…' : `Enviar reclamo${elegidas.length ? ` (${elegidas.length})` : ''}`}
            </button>
            <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>
              Va al cliente con copia a administración. No toca la configuración del recordatorio automático.
            </span>
          </div>
        </div>
      )}

      {msg && <p style={{ margin: '8px 0 0', fontSize: '11.5px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>}
    </div>
  );
}
