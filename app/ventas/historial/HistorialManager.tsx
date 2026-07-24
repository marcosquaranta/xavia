'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface EntradaExp {
  id_exportacion: string; fecha: string; fecha_exportacion: string;
  facturas: number; clientesNombres: string[];
  rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
}
interface EntradaPend {
  fecha: string; filas: number; rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');
const fmtKg = (n: number) => n > 0 ? `${n.toFixed(1)} kg` : '—';

export default function HistorialManager() {
  const [loading, setLoading] = useState(true);
  const [exportaciones, setExportaciones] = useState<EntradaExp[]>([]);
  const [pendientes, setPendientes] = useState<EntradaPend[]>([]);
  const [filtro, setFiltro] = useState('');
  const [limpiando, setLimpiando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function cargar() {
    setLoading(true);
    fetch('/api/ventas/historial').then(r => r.json()).then(j => {
      setExportaciones(j.exportaciones || []);
      setPendientes(j.pendientes || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { cargar(); }, []);

  async function limpiarTodo() {
    if (!confirm('¿Limpiar TODAS las ventas de la hoja? Esto no se puede deshacer.')) return;
    setLimpiando(true); setMsg(null);
    try {
      await fetch('/api/ventas/limpiar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limpiarTodo: true }) });
      setMsg('Hoja limpiada.');
      cargar();
    } catch (e: any) { setMsg(e.message); }
    setLimpiando(false);
  }

  const q = filtro.trim().toLowerCase();
  const expFiltradas = q
    ? exportaciones.filter(e => e.clientesNombres.some(c => c.toLowerCase().includes(q)) || e.fecha.includes(q) || e.id_exportacion.toLowerCase().includes(q))
    : exportaciones;

  if (loading) return <p style={{ color: '#9ca3af', fontSize: '13px' }}>Cargando…</p>;

  return (
    <div>
      {/* ── No facturado ── */}
      <div style={{ marginBottom: '24px' }}>
        <p className="card-title" style={{ marginBottom: '2px' }}>🕓 No facturado</p>
        <p className="card-sub">Cargado en Ventas pero todavía sin enviar a Xubio</p>
        {pendientes.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px' }}>No hay nada pendiente de facturar.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '13px', width: '100%' }}>
              <thead><tr style={{ background: '#fefce8', borderBottom: '1px solid #fde68a' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Fecha</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula kg</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga kg</th>
                <th style={{ padding: '6px 10px' }}></th>
              </tr></thead>
              <tbody>
                {pendientes.map(h => (
                  <tr key={h.fecha} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '7px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.fecha}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#166534' }}>{h.rucula > 0 ? fmt(h.rucula) : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#4d7c0f' }}>{h.lechuga > 0 ? fmt(h.lechuga) : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#92400e' }}>{fmtKg(h.rucula_kg)}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#b45309' }}>{fmtKg(h.lechuga_kg)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                      <Link href={`/ventas?fecha=${h.fecha}`} className="btn secondary small">Ir a cargar →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Facturado ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '2px' }}>
          <p className="card-title" style={{ margin: 0 }}>📤 Facturado</p>
          <input type="text" value={filtro} onChange={ev => setFiltro(ev.target.value)} placeholder="Buscar por cliente, fecha o N° de exportación…"
            style={{ fontSize: '12px', padding: '5px 10px', maxWidth: '280px' }} />
        </div>
        <p className="card-sub">Ya enviado a Xubio · últimas {exportaciones.length} exportaciones</p>
        {expFiltradas.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px' }}>{q ? 'Sin resultados para ese filtro.' : 'Todavía no se facturó nada.'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '13px', width: '100%' }}>
              <thead><tr style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>N° exportación</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Clientes</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula kg</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga kg</th>
                <th style={{ padding: '6px 10px' }}></th>
              </tr></thead>
              <tbody>
                {expFiltradas.map(h => (
                  <tr key={h.id_exportacion} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '7px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.fecha}</td>
                    <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#1e40af', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.id_exportacion}</td>
                    <td style={{ padding: '7px 10px', color: '#374151' }}>{h.clientesNombres.join(' · ')}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#166534' }}>{h.rucula > 0 ? fmt(h.rucula) : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#4d7c0f' }}>{h.lechuga > 0 ? fmt(h.lechuga) : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#92400e' }}>{fmtKg(h.rucula_kg)}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: '#b45309' }}>{fmtKg(h.lechuga_kg)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                      <Link href={`/ventas?fecha=${h.fecha}&exportacion=${h.id_exportacion}`} className="btn secondary small">✏️ Editar →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Zona de riesgo ── */}
      <div style={{ marginTop: '28px', borderTop: '1px solid #f3f4f6', paddingTop: '14px', textAlign: 'right' }}>
        {msg && <p style={{ fontSize: '12px', color: '#374151', margin: '0 0 6px' }}>{msg}</p>}
        <button onClick={limpiarTodo} disabled={limpiando}
          style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer', color: '#dc2626' }}>
          🗑 Limpiar toda la hoja de Ventas
        </button>
      </div>
    </div>
  );
}
