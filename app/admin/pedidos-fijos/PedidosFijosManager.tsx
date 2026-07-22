'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClienteVenta, PedidoFijo } from '@/lib/types';

interface Props { clientes: ClienteVenta[]; pedidos: PedidoFijo[]; }

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const PRODUCTOS = [
  { key: 'rucula', label: 'Rúcula' },
  { key: 'lechuga_crespa', label: 'Crespa' },
  { key: 'hoja_roble', label: 'Hoja Roble' },
  { key: 'bandeja_rucula', label: 'Bandeja' },
  { key: 'albahaca', label: 'Albahaca' },
] as const;

interface FilaCliente { id_control: string; nombre_cliente: string; sucursal: string; nombre_display: string }

function mkFilas(cs: ClienteVenta[]): FilaCliente[] {
  const out: FilaCliente[] = [];
  for (const c of cs) {
    if (c.activo !== 'SI') continue;
    const sucs = c.sucursales ? c.sucursales.split('|').map((s) => s.trim()).filter(Boolean) : [];
    if (!sucs.length) out.push({ id_control: c.id_control, nombre_cliente: c.nombre_xubio, sucursal: c.nombre_xubio, nombre_display: c.nombre_display || c.nombre_xubio });
    else for (const s of sucs) out.push({ id_control: c.id_control, nombre_cliente: c.nombre_xubio, sucursal: s, nombre_display: `${c.nombre_display || c.nombre_xubio} · ${s.split(' ').slice(-1)[0]}` });
  }
  return out.sort((a, b) => a.nombre_display.localeCompare(b.nombre_display));
}

export default function PedidosFijosManager({ clientes, pedidos }: Props) {
  const router = useRouter();
  const filas = mkFilas(clientes);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [filaSel, setFilaSel] = useState(filas[0] ? `${filas[0].id_control}__${filas[0].sucursal}` : '');
  const [dia, setDia] = useState(1); // lunes por defecto
  const [cant, setCant] = useState<Record<string, string>>({ rucula: '', lechuga_crespa: '', hoja_roble: '', bandeja_rucula: '', albahaca: '' });
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fila = filas.find((f) => `${f.id_control}__${f.sucursal}` === filaSel);
    if (!fila) { setError('Elegí un cliente'); return; }
    const tieneAlgo = PRODUCTOS.some((p) => Number(cant[p.key]) > 0);
    if (!tieneAlgo) { setError('Cargá al menos una cantidad'); return; }
    setGuardando(true);
    try {
      const res = await fetch('/api/admin/pedidos-fijos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_control: fila.id_control, nombre_cliente: fila.nombre_cliente, sucursal: fila.sucursal,
          dia_semana: dia, notas,
          ...Object.fromEntries(PRODUCTOS.map((p) => [p.key, Number(cant[p.key]) || 0])),
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      setCant({ rucula: '', lechuga_crespa: '', hoja_roble: '', bandeja_rucula: '', albahaca: '' });
      setNotas('');
      setMostrarForm(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo(p: PedidoFijo) {
    await fetch('/api/admin/pedidos-fijos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_pedido_fijo: p.id_pedido_fijo, activo: p.activo === 'SI' ? 'NO' : 'SI' }),
    });
    router.refresh();
  }

  async function borrar(id: string) {
    if (!confirm('¿Borrar este pedido fijo?')) return;
    setBorrando(id);
    try {
      await fetch('/api/admin/pedidos-fijos', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_pedido_fijo: id }) });
      router.refresh();
    } finally {
      setBorrando(null);
    }
  }

  const porDia = DIAS.map((label, i) => ({ label, dia: i, pedidos: pedidos.filter((p) => Number(p.dia_semana) === i) }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>
          Se pre-cargan solos en Ventas ese día de la semana — no pisan nada si ya hay algo cargado, y siguen siendo editables antes de guardar.
        </p>
        <button className="btn" onClick={() => setMostrarForm((v) => !v)}>{mostrarForm ? 'Cancelar' : '+ Nuevo pedido fijo'}</button>
      </div>

      {mostrarForm && (
        <form onSubmit={crear} className="card" style={{ marginBottom: '14px' }}>
          {error && <div className="alert-box error" style={{ marginBottom: '12px' }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label>Cliente</label>
              <select value={filaSel} onChange={(e) => setFilaSel(e.target.value)} disabled={guardando}>
                {filas.map((f) => <option key={`${f.id_control}__${f.sucursal}`} value={`${f.id_control}__${f.sucursal}`}>{f.nombre_display}</option>)}
              </select>
            </div>
            <div>
              <label>Día de la semana</label>
              <select value={dia} onChange={(e) => setDia(Number(e.target.value))} disabled={guardando}>
                {DIAS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px', marginBottom: '14px' }}>
            {PRODUCTOS.map((p) => (
              <div key={p.key}>
                <label style={{ fontSize: '11px' }}>{p.label}</label>
                <input type="number" min={0} value={cant[p.key]} onChange={(e) => setCant((c) => ({ ...c, [p.key]: e.target.value }))} disabled={guardando} placeholder="0" />
              </div>
            ))}
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label>Notas (opcional)</label>
            <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} disabled={guardando} placeholder="Ej: confirmar por WhatsApp antes de repartir" />
          </div>
          <button type="submit" className="btn" disabled={guardando}>{guardando ? 'Guardando…' : 'Crear pedido fijo'}</button>
        </form>
      )}

      {porDia.every((d) => d.pedidos.length === 0) ? (
        <div className="card" style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>Todavía no hay pedidos fijos configurados.</div>
      ) : (
        porDia.filter((d) => d.pedidos.length > 0).map((d) => (
          <div key={d.dia} className="card" style={{ marginBottom: '10px' }}>
            <p className="card-title">{d.label}</p>
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  {PRODUCTOS.map((p) => <th key={p.key} style={{ textAlign: 'right' }}>{p.label}</th>)}
                  <th>Notas</th>
                  <th style={{ textAlign: 'center' }}>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {d.pedidos.map((p) => (
                  <tr key={p.id_pedido_fijo} style={{ opacity: p.activo === 'SI' ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 500 }}>{p.nombre_cliente}{p.sucursal && p.sucursal !== p.nombre_cliente ? ` · ${p.sucursal}` : ''}</td>
                    {PRODUCTOS.map((prod) => (
                      <td key={prod.key} style={{ textAlign: 'right', color: Number((p as any)[prod.key]) > 0 ? '#111827' : '#d1d5db' }}>
                        {Number((p as any)[prod.key]) > 0 ? Number((p as any)[prod.key]) : '—'}
                      </td>
                    ))}
                    <td style={{ color: '#9ca3af', fontSize: '11px' }}>{p.notas || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button onClick={() => toggleActivo(p)} style={{ background: p.activo === 'SI' ? '#d1fae5' : '#fee2e2', color: p.activo === 'SI' ? '#065f46' : '#7f1d1d', border: 'none', borderRadius: '4px', padding: '3px 10px', fontSize: '11px', fontWeight: 500, cursor: 'pointer' }}>
                        {p.activo === 'SI' ? 'Activo' : 'Pausado'}
                      </button>
                    </td>
                    <td>
                      <button onClick={() => borrar(p.id_pedido_fijo)} disabled={borrando === p.id_pedido_fijo}
                        style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '5px', padding: '2px 7px', fontSize: '11px', cursor: 'pointer' }}>
                        {borrando === p.id_pedido_fijo ? '…' : '✕'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
