'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClienteVenta, PrecioVenta } from '@/lib/types';

interface Props { clientes: ClienteVenta[]; precios: PrecioVenta[]; }

const PROD_LABELS = [
  { key: 'rucula',         label: 'Rúcula' },
  { key: 'lechuga_crespa', label: 'Lechuga Crespa' },
  { key: 'hoja_roble',     label: 'Hoja de Roble' },
  { key: 'bandeja_rucula', label: 'Bandeja Rúcula' },
  { key: 'albahaca',       label: 'Albahaca' },
];
// lechuga_kg (precio único, legacy) ya no se edita acá — reemplazado por precio propio
// por variedad. El valor viejo se preserva en la planilla pero no se toca desde este form.
const KG_LABELS = [
  { key: 'rucula_kg',         label: 'Rúcula KG' },
  { key: 'lechuga_kg_crespa', label: 'Lechuga Crespa KG' },
  { key: 'lechuga_kg_roble',  label: 'Lechuga Roble KG' },
];

function PreciosSucursal({ idControl, nombreCliente, sucursalObs, precioActual, esKg, onSaved }: {
  idControl: string; nombreCliente: string; sucursalObs: string;
  precioActual: PrecioVenta | undefined; esKg: boolean; onSaved: () => void;
}) {
  const campos = esKg ? KG_LABELS : PROD_LABELS;
  const [vals, setVals] = useState<Record<string,string>>(() =>
    Object.fromEntries(campos.map(p => [p.key, precioActual ? String((precioActual as any)[p.key] || '') : '']))
  );
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function guardar() {
    setSaving(true); setOk(false); setErr(null);
    try {
      const res = await fetch('/api/admin/precios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: idControl, nombre_cliente: nombreCliente, sucursal_obs: sucursalObs,
          ...Object.fromEntries(campos.map(p => [p.key, Number(vals[p.key]) || 0])) }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      setOk(true); setTimeout(() => setOk(false), 2000);
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ background: esKg ? '#fffbeb' : '#f9fafb', border: `1px solid ${esKg ? '#fde68a' : '#f3f4f6'}`, borderRadius: '6px', padding: '10px 12px', marginBottom: '8px' }}>
      <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color: esKg ? '#92400e' : '#374151' }}>
        {sucursalObs}{esKg && <span style={{ marginLeft: '6px', fontWeight: 400, fontSize: '10px' }}>· precios por KG (cajón)</span>}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(campos.length, 5)}, 1fr)`, gap: '6px', marginBottom: '8px' }}>
        {campos.map(p => (
          <div key={p.key}>
            <label style={{ fontSize: '10px' }}>{p.label}</label>
            <input type="number" value={vals[p.key]} onChange={e => setVals(v => ({ ...v, [p.key]: e.target.value }))}
              min="0" style={{ padding: '4px 6px', fontSize: '12px' }} disabled={saving} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button className="btn" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={guardar} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar precios'}
        </button>
        {ok && <span style={{ fontSize: '11px', color: '#059669' }}>✓ Guardado</span>}
        {err && <span style={{ fontSize: '11px', color: '#dc2626' }}>{err}</span>}
      </div>
    </div>
  );
}

function ClienteRow({ c, precios, onSaved }: { c: ClienteVenta; precios: PrecioVenta[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [fields, setFields] = useState({
    nombre_xubio: c.nombre_xubio,
    nombre_display: c.nombre_display || '',
    alias: c.alias || '',
    tipo_factura: c.tipo_factura,
    punto_venta: String(c.punto_venta || ''),
    sucursales: c.sucursales || '',
    unidad: String(c.unidad || 'paq'),
    orden: String(c.orden || ''),
  });

  const sucursalesArr = fields.sucursales ? fields.sucursales.split('|').map(s => s.trim()).filter(Boolean) : [];
  const sucursalObs = sucursalesArr.length === 0 ? c.nombre_xubio : null;

  async function guardarCliente() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/admin/clientes-venta', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: c.id_control, ...fields }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function toggleActivo() {
    setSaving(true);
    try {
      await fetch('/api/admin/clientes-venta', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: c.id_control, activo: c.activo === 'SI' ? 'NO' : 'SI' }),
      });
      onSaved();
    } catch {}
    finally { setSaving(false); }
  }

  const pFirst = precios.find(p => String(p.id_control) === String(c.id_control));

  return (
    <>
      <tr style={{ opacity: c.activo === 'NO' ? 0.5 : 1, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#6b7280', fontSize: '11px' }}>{c.id_control}</td>
        <td style={{ fontWeight: 500 }}>{c.nombre_xubio}</td>
        <td style={{ color: '#6b7280', fontSize: '12px' }}>{c.alias || c.nombre_display}</td>
        <td style={{ fontSize: '11px', color: '#6b7280' }}>{c.sucursales || '—'}</td>
        <td style={{ textAlign: 'center', fontSize: '12px', color: c.orden ? '#111827' : '#d1d5db' }}>{c.orden || '—'}</td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ background: c.tipo_factura === 'A' ? '#dbeafe' : '#f3f4f6', color: c.tipo_factura === 'A' ? '#1e40af' : '#374151', padding: '1px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
            {c.tipo_factura}
          </span>
        </td>
        <td style={{ textAlign: 'right', fontSize: '12px' }}>{pFirst ? `$${Number(pFirst.rucula).toLocaleString('es-AR')}` : '—'}</td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#6b7280' }}>{open ? '▲' : '▼'}</span>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={8} style={{ padding: '0 0 12px', background: '#fafafa' }}>
            <div style={{ padding: '14px', borderTop: '1px solid #f3f4f6' }}>

              {/* Datos del cliente */}
              <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>Datos del cliente</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px' }}>Nombre en Xubio</label>
                  <input type="text" value={fields.nombre_xubio} onChange={e => setFields(f => ({ ...f, nombre_xubio: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Nombre display</label>
                  <input type="text" value={fields.nombre_display} onChange={e => setFields(f => ({ ...f, nombre_display: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Alias</label>
                  <input type="text" value={fields.alias} onChange={e => setFields(f => ({ ...f, alias: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Tipo factura</label>
                  <select value={fields.tipo_factura} onChange={e => setFields(f => ({ ...f, tipo_factura: e.target.value }))} disabled={saving}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Punto de venta</label>
                  <input type="number" value={fields.punto_venta} onChange={e => setFields(f => ({ ...f, punto_venta: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Sucursales (separadas por |)</label>
                  <input type="text" value={fields.sucursales} onChange={e => setFields(f => ({ ...f, sucursales: e.target.value }))} disabled={saving} placeholder="Ej: Norte|Sur|Centro" />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Unidad de venta</label>
                  <select value={fields.unidad} onChange={e => setFields(f => ({ ...f, unidad: e.target.value }))} disabled={saving}>
                    <option value="paq">Paquetes</option>
                    <option value="kg">KG (cajón) — ej. Select Food</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Orden en carga de Ventas</label>
                  <input type="number" value={fields.orden} onChange={e => setFields(f => ({ ...f, orden: e.target.value }))} disabled={saving} placeholder="sin fijar = por frecuencia" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
                <button className="btn" style={{ fontSize: '11px', padding: '5px 12px' }} onClick={guardarCliente} disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar datos'}
                </button>
                <button className="btn secondary" style={{ fontSize: '11px', padding: '5px 12px' }} onClick={toggleActivo} disabled={saving}>
                  {c.activo === 'SI' ? 'Desactivar' : 'Activar'}
                </button>
                {err && <span style={{ fontSize: '11px', color: '#dc2626' }}>{err}</span>}
              </div>

              {/* Precios por sucursal */}
              <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>Precios</p>
              {sucursalesArr.length > 0
                ? sucursalesArr.map(suc => (
                    <PreciosSucursal key={suc}
                      idControl={String(c.id_control)} nombreCliente={c.nombre_xubio} sucursalObs={suc}
                      precioActual={precios.find(p => String(p.id_control) === String(c.id_control) && p.sucursal_obs === suc)}
                      esKg={c.unidad === 'kg'} onSaved={onSaved} />
                  ))
                : <PreciosSucursal
                    idControl={String(c.id_control)} nombreCliente={c.nombre_xubio} sucursalObs={c.nombre_xubio}
                    precioActual={precios.find(p => String(p.id_control) === String(c.id_control))}
                    esKg={c.unidad === 'kg'} onSaved={onSaved} />
              }
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ClientesVentaManager({ clientes, precios }: Props) {
  const router = useRouter();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [ok, setOk] = useState(false);
  const [nombreXubio, setNombreXubio] = useState('');
  const [alias, setAlias] = useState('');
  const [tipoFactura, setTipoFactura] = useState('A');
  const [puntoVenta, setPuntoVenta] = useState('2');
  const [sucursales, setSucursales] = useState('');

  function reset() { setNombreXubio(''); setAlias(''); setTipoFactura('A'); setPuntoVenta('2'); setSucursales(''); setError(null); setOk(false); }

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null); setOk(false);
    try {
      const res = await fetch('/api/admin/clientes-venta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre_xubio: nombreXubio.trim(), alias: alias.trim(), tipo_factura: tipoFactura, punto_venta: puntoVenta, sucursales: sucursales.trim() }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      setOk(true); setMostrarForm(false); reset(); router.refresh();
    } catch (err: any) { setError(err.message || 'Error al crear'); }
    finally { setLoading(false); }
  }

  const activos = clientes.filter(c => c.activo === 'SI');
  const inactivos = clientes.filter(c => c.activo === 'NO');

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>{activos.length} activos · {inactivos.length} inactivos</p>
        {!mostrarForm && <button type="button" className="btn" onClick={() => { reset(); setMostrarForm(true); }}>+ Nuevo cliente</button>}
      </div>

      {ok && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#166534' }}>✓ Cliente creado</div>}

      {mostrarForm && (
        <form onSubmit={crear} className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Nuevo cliente</p>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: '#dc2626' }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Nombre en Xubio *</label>
              <input type="text" value={nombreXubio} onChange={e => setNombreXubio(e.target.value)} required disabled={loading} />
            </div>
            <div><label>Alias</label><input type="text" value={alias} onChange={e => setAlias(e.target.value)} disabled={loading} /></div>
            <div><label>Tipo factura</label>
              <select value={tipoFactura} onChange={e => setTipoFactura(e.target.value)} disabled={loading}>
                <option value="A">A</option><option value="B">B</option>
              </select>
            </div>
            <div><label>Punto de venta</label><input type="number" value={puntoVenta} onChange={e => setPuntoVenta(e.target.value)} required disabled={loading} /></div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Sucursales (separadas por |) — dejar vacío si es un solo punto</label>
              <input type="text" value={sucursales} onChange={e => setSucursales(e.target.value)} disabled={loading} placeholder="Ej: Norte|Sur|Centro" />
            </div>
          </div>
          <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#6b7280' }}>Los precios se cargan después desde el panel de edición del cliente.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="btn" disabled={loading}>{loading ? 'Guardando…' : 'Crear cliente'}</button>
            <button type="button" className="btn secondary" onClick={() => { setMostrarForm(false); reset(); }} disabled={loading}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card">
        <p className="card-title">Clientes · click para editar</p>
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'center', width: '40px' }}>ID</th>
              <th>Nombre Xubio</th>
              <th>Alias / Display</th>
              <th>Sucursales</th>
              <th style={{ textAlign: 'center', width: '55px' }} title="Orden en la carga de Ventas">Orden</th>
              <th style={{ textAlign: 'center' }}>Fact.</th>
              <th style={{ textAlign: 'right' }}>Rúcula</th>
              <th style={{ width: '30px' }}></th>
            </tr>
          </thead>
          <tbody>
            {activos.map(c => <ClienteRow key={c.id_control} c={c} precios={precios} onSaved={() => router.refresh()} />)}
            {inactivos.length > 0 && (
              <>
                <tr><td colSpan={8} style={{ padding: '8px 6px 4px', fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Inactivos</td></tr>
                {inactivos.map(c => <ClienteRow key={c.id_control} c={c} precios={precios} onSaved={() => router.refresh()} />)}
              </>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
