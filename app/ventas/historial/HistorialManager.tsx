'use client';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import type { VentaDia } from '@/lib/types';

interface EntradaExpCliente {
  id_exportacion: string; fecha: string; fecha_exportacion: string; cliente: string; id_control: string;
  rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
}
interface EntradaPend {
  fecha: string; filas: number; rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');
const fmtKg = (n: number) => n > 0 ? `${n.toFixed(1)} kg` : '—';

const CAMPOS = [
  { key: 'rucula', label: 'Rúcula' },
  { key: 'lechuga_crespa', label: 'Crespa' },
  { key: 'hoja_roble', label: 'Hoja Roble' },
  { key: 'bandeja_rucula', label: 'Bandeja' },
  { key: 'albahaca', label: 'Albahaca' },
  { key: 'rucula_kg', label: 'Rúcula kg' },
  { key: 'lechuga_kg_crespa', label: 'Crespa kg' },
  { key: 'lechuga_kg_roble', label: 'Roble kg' },
] as const;

// Editor inline de una venta puntual ya facturada — corrige el registro interno de Xavia
// (no anula la factura real ya emitida en Xubio) sin salir de esta página.
function EditorFacturadoDetalle({ idExportacion, idControl, fecha, onGuardado, onFilaEliminada, onCerrar }: {
  idExportacion: string; idControl: string; fecha: string; onGuardado: () => void; onFilaEliminada: () => void; onCerrar: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [filas, setFilas] = useState<VentaDia[]>([]);
  // Ojo: puede haber varias filas con la misma (fecha, cliente, sucursal) — filas
  // repetidas por error de carga — así que el estado se indexa por id_venta (único por
  // fila real), nunca por sucursal, o editar/borrar una repetida movería a todas juntas.
  const [valores, setValores] = useState<Record<string, Record<string, string>>>({});
  const [guardando, setGuardando] = useState(false);
  const [eliminandoFila, setEliminandoFila] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/ventas/fecha?id_exportacion=${idExportacion}`).then(r => r.json()).then((data: VentaDia[]) => {
      const propias = data.filter(v => String(v.id_control) === String(idControl));
      setFilas(propias);
      const v0: Record<string, Record<string, string>> = {};
      for (const f of propias) {
        v0[f.id_venta] = {};
        for (const c of CAMPOS) v0[f.id_venta][c.key] = String(Number((f as any)[c.key]) || '');
      }
      setValores(v0);
    }).catch(() => setError('No se pudo cargar el detalle.')).finally(() => setLoading(false));
  }, [idExportacion, idControl]);

  function setVal(id_venta: string, key: string, val: string) {
    setValores(prev => ({ ...prev, [id_venta]: { ...prev[id_venta], [key]: val } }));
  }

  async function guardar() {
    setGuardando(true); setError(null);
    try {
      const lineas = filas.map(f => {
        const v = valores[f.id_venta] || {};
        const g = (k: string) => Number(v[k]) || 0;
        return {
          id_venta: f.id_venta, id_control: idControl, nombre_cliente: f.nombre_cliente, sucursal: f.sucursal,
          rucula: g('rucula'), lechuga_crespa: g('lechuga_crespa'), hoja_roble: g('hoja_roble'),
          bandeja_rucula: g('bandeja_rucula'), albahaca: g('albahaca'),
          rucula_kg: g('rucula_kg'), lechuga_kg_crespa: g('lechuga_kg_crespa'), lechuga_kg_roble: g('lechuga_kg_roble'),
        };
      });
      const r = await fetch('/api/ventas/guardar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fecha, id_exportacion: idExportacion, lineas }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      onGuardado();
    } catch (e: any) { setError(e.message); }
    setGuardando(false);
  }

  async function eliminarFila(id_venta: string) {
    if (!confirm('¿Eliminar esta fila? Esto no se puede deshacer.')) return;
    setEliminandoFila(id_venta); setError(null);
    try {
      const r = await fetch('/api/ventas/limpiar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_venta }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      setFilas(prev => prev.filter(f => f.id_venta !== id_venta));
      onFilaEliminada();
    } catch (e: any) { setError(e.message); }
    setEliminandoFila(null);
  }

  if (loading) return <p style={{ fontSize: '12px', color: '#9ca3af', margin: '8px 0' }}>Cargando detalle…</p>;
  if (filas.length === 0) return <p style={{ fontSize: '12px', color: '#9ca3af', margin: '8px 0' }}>No se encontraron filas para editar.</p>;

  return (
    <div style={{ padding: '10px 12px', background: 'white', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
      {error && <p style={{ color: '#dc2626', fontSize: '12px', margin: '0 0 8px' }}>{error}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: '12px', width: '100%' }}>
          <thead><tr>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Sucursal</th>
            {CAMPOS.map(c => <th key={c.key} style={{ textAlign: 'center', padding: '4px 6px' }}>{c.label}</th>)}
            <th style={{ padding: '4px 6px' }}></th>
          </tr></thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.id_venta}>
                <td style={{ padding: '4px 6px', fontWeight: 600, whiteSpace: 'nowrap' }}>{f.sucursal}</td>
                {CAMPOS.map(c => (
                  <td key={c.key} style={{ padding: '3px 4px' }}>
                    <input type="number" min={0} step="any" value={valores[f.id_venta]?.[c.key] ?? ''}
                      onChange={ev => setVal(f.id_venta, c.key, ev.target.value)}
                      style={{ width: '72px', textAlign: 'center', fontSize: '12px', padding: '4px' }} />
                  </td>
                ))}
                <td style={{ padding: '3px 4px' }}>
                  <button onClick={() => eliminarFila(f.id_venta)} disabled={eliminandoFila === f.id_venta}
                    title="Eliminar esta fila (ej. venta duplicada)"
                    style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '5px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', color: '#dc2626', whiteSpace: 'nowrap' }}>
                    {eliminandoFila === f.id_venta ? '…' : '🗑'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
        <button onClick={guardar} disabled={guardando} className="btn" style={{ fontSize: '12px', padding: '6px 14px' }}>
          {guardando ? 'Guardando…' : '✓ Guardar cambios'}
        </button>
        <button onClick={onCerrar} className="btn secondary" style={{ fontSize: '12px', padding: '6px 14px' }}>Cerrar</button>
      </div>
    </div>
  );
}

export default function HistorialManager() {
  const [loading, setLoading] = useState(true);
  const [exportaciones, setExportaciones] = useState<EntradaExpCliente[]>([]);
  const [pendientes, setPendientes] = useState<EntradaPend[]>([]);
  const [filtro, setFiltro] = useState('');
  const [limpiando, setLimpiando] = useState(false);
  const [eliminandoTodosPend, setEliminandoTodosPend] = useState(false);
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function cargar() {
    setLoading(true);
    fetch('/api/ventas/historial').then(r => r.json()).then(j => {
      setExportaciones(j.exportaciones || []);
      setPendientes(j.pendientes || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { cargar(); }, []);

  async function limpiar(body: Record<string, any>) {
    const r = await fetch('/api/ventas/limpiar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
  }

  async function eliminarPendiente(fecha: string) {
    if (!confirm(`¿Eliminar todas las ventas no facturadas del ${fecha}? Esto no se puede deshacer.`)) return;
    setEliminando(fecha); setMsg(null);
    try { await limpiar({ fecha, limpiarTodo: false }); cargar(); }
    catch (e: any) { setMsg(e.message); }
    setEliminando(null);
  }

  async function eliminarTodosPendientes() {
    if (!confirm('¿Eliminar TODAS las ventas no facturadas (de cualquier fecha)? Esto no se puede deshacer.')) return;
    setEliminandoTodosPend(true); setMsg(null);
    try { await limpiar({ soloPendientes: true }); cargar(); }
    catch (e: any) { setMsg(e.message); }
    setEliminandoTodosPend(false);
  }

  async function eliminarFacturado(id_exportacion: string, id_control: string, cliente: string) {
    if (!confirm(`¿Eliminar la venta de ${cliente} en la exportación ${id_exportacion}? Esto corrige solo el registro interno de Xavia — no anula la factura ya emitida en Xubio.`)) return;
    setEliminando(`${id_exportacion}__${id_control}`); setMsg(null);
    try { await limpiar({ id_exportacion, id_control }); cargar(); }
    catch (e: any) { setMsg(e.message); }
    setEliminando(null);
  }

  async function limpiarTodo() {
    if (!confirm('¿Limpiar TODAS las ventas de la hoja? Esto no se puede deshacer.')) return;
    setLimpiando(true); setMsg(null);
    try {
      await limpiar({ limpiarTodo: true });
      setMsg('Hoja limpiada.');
      cargar();
    } catch (e: any) { setMsg(e.message); }
    setLimpiando(false);
  }

  const q = filtro.trim().toLowerCase();
  const expFiltradas = q
    ? exportaciones.filter(e => e.cliente.toLowerCase().includes(q) || e.fecha.includes(q) || e.id_exportacion.toLowerCase().includes(q))
    : exportaciones;

  if (loading) return <p style={{ color: '#9ca3af', fontSize: '13px' }}>Cargando…</p>;

  return (
    <div>
      {/* ── No facturado ── */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '2px' }}>
          <p className="card-title" style={{ margin: 0 }}>🕓 No facturado</p>
          {pendientes.length > 0 && (
            <button onClick={eliminarTodosPendientes} disabled={eliminandoTodosPend}
              style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', color: '#dc2626' }}>
              {eliminandoTodosPend ? 'Eliminando…' : '🗑 Eliminar todos'}
            </button>
          )}
        </div>
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
                    <td style={{ padding: '7px 10px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Link href={`/ventas?fecha=${h.fecha}`} className="btn secondary small">Ir a cargar →</Link>
                      <button onClick={() => eliminarPendiente(h.fecha)} disabled={eliminando === h.fecha}
                        style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '6px', padding: '5px 10px', fontSize: '11px', cursor: 'pointer', color: '#dc2626' }}>
                        {eliminando === h.fecha ? 'Eliminando…' : '🗑 Eliminar'}
                      </button>
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
        <p className="card-sub">Ya enviado a Xubio · más reciente primero · {exportaciones.length} líneas</p>
        {expFiltradas.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px' }}>{q ? 'Sin resultados para ese filtro.' : 'Todavía no se facturó nada.'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '13px', width: '100%' }}>
              <thead><tr style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>N° exportación</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Cliente</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Rúcula kg</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Lechuga kg</th>
                <th style={{ padding: '6px 10px' }}></th>
              </tr></thead>
              <tbody>
                {expFiltradas.map(h => {
                  const key = `${h.id_exportacion}__${h.id_control}`;
                  const abierto = editando === key;
                  return (
                  <Fragment key={key}>
                    <tr style={{ borderBottom: abierto ? 'none' : '1px solid #f3f4f6', background: abierto ? '#eff6ff' : undefined }}>
                      <td style={{ padding: '7px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.fecha}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#1e40af', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.id_exportacion}</td>
                      <td style={{ padding: '7px 10px', color: '#374151' }}>{h.cliente}</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#166534' }}>{h.rucula > 0 ? fmt(h.rucula) : '—'}</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#4d7c0f' }}>{h.lechuga > 0 ? fmt(h.lechuga) : '—'}</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#92400e' }}>{fmtKg(h.rucula_kg)}</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#b45309' }}>{fmtKg(h.lechuga_kg)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditando(abierto ? null : key)} className="btn secondary small">
                          {abierto ? '▲ Cerrar' : '✏️ Editar'}
                        </button>
                        <button onClick={() => eliminarFacturado(h.id_exportacion, h.id_control, h.cliente)} disabled={eliminando === key}
                          style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '6px', padding: '5px 10px', fontSize: '11px', cursor: 'pointer', color: '#dc2626' }}>
                          {eliminando === key ? 'Eliminando…' : '🗑 Eliminar'}
                        </button>
                      </td>
                    </tr>
                    {abierto && (
                      <tr style={{ borderBottom: '1px solid #f3f4f6', background: '#eff6ff' }}>
                        <td colSpan={8} style={{ padding: '0 10px 12px' }}>
                          <EditorFacturadoDetalle idExportacion={h.id_exportacion} idControl={h.id_control} fecha={h.fecha}
                            onGuardado={() => { setEditando(null); cargar(); }} onFilaEliminada={cargar} onCerrar={() => setEditando(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
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
