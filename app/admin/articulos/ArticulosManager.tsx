'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Articulo } from '@/lib/types';
import { DRIVERS } from '@/lib/usoTeorico';

interface Props { articulos: Articulo[]; }

function ArticuloRow({ a, onSaved }: { a: Articulo; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState({
    categoria: a.categoria, articulo: a.articulo, unidad_medida: a.unidad_medida,
    formula_uso: a.formula_uso || '', factor_uso: String(a.factor_uso ?? ''),
  });

  async function guardar() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/admin/articulos', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_articulo: a.id_articulo, ...fields, factor_uso: Number(fields.factor_uso) || 0 }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function toggleActivo() {
    setSaving(true);
    try {
      await fetch('/api/admin/articulos', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_articulo: a.id_articulo, activo: a.activo === 'SI' ? 'NO' : 'SI' }),
      });
      onSaved();
    } catch {}
    finally { setSaving(false); }
  }

  const driverLabel = DRIVERS.find((d) => d.key === a.formula_uso)?.label;

  return (
    <>
      <tr style={{ opacity: a.activo === 'NO' ? 0.5 : 1, cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <td style={{ fontFamily: 'monospace', color: '#6b7280', fontSize: '11px' }}>{a.id_articulo}</td>
        <td style={{ fontWeight: 500 }}>{a.articulo}</td>
        <td style={{ color: '#6b7280', fontSize: '12px' }}>{a.categoria}</td>
        <td style={{ textAlign: 'center', color: '#9ca3af', fontSize: '11px' }}>{a.unidad_medida}</td>
        <td style={{ fontSize: '11px', color: driverLabel ? '#374151' : '#d1d5db' }}>
          {driverLabel ? `${driverLabel} × ${a.factor_uso}` : '— sin configurar —'}
        </td>
        <td style={{ textAlign: 'center' }}><span style={{ fontSize: '11px', color: '#6b7280' }}>{open ? '▲' : '▼'}</span></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ padding: '0 0 12px', background: '#fafafa' }}>
            <div style={{ padding: '14px', borderTop: '1px solid #f3f4f6' }}>
              {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '6px 10px', marginBottom: '10px', fontSize: '12px', color: '#dc2626' }}>{err}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px' }}>Nombre</label>
                  <input type="text" value={fields.articulo} onChange={(e) => setFields((f) => ({ ...f, articulo: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Categoría</label>
                  <input type="text" value={fields.categoria} onChange={(e) => setFields((f) => ({ ...f, categoria: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Unidad</label>
                  <input type="text" value={fields.unidad_medida} onChange={(e) => setFields((f) => ({ ...f, unidad_medida: e.target.value }))} disabled={saving} />
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Fórmula de uso teórico</label>
                  <select value={fields.formula_uso} onChange={(e) => setFields((f) => ({ ...f, formula_uso: e.target.value }))} disabled={saving}>
                    <option value="">— sin fórmula —</option>
                    {DRIVERS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>Factor (por unidad del driver)</label>
                  <input type="number" step="0.0001" value={fields.factor_uso} onChange={(e) => setFields((f) => ({ ...f, factor_uso: e.target.value }))} disabled={saving} placeholder="Ej: 3 (cubos por plancha)" />
                </div>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#9ca3af' }}>
                Uso teórico del mes = valor del driver elegido × factor. Ej: Bolsas → "Paquetes vendidos — rúcula" × 1; Espumas/cubos → "Planchas sembradas — total" × N.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn" style={{ fontSize: '11px', padding: '5px 12px' }} onClick={guardar} disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button className="btn secondary" style={{ fontSize: '11px', padding: '5px 12px' }} onClick={toggleActivo} disabled={saving}>
                  {a.activo === 'SI' ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ArticulosManager({ articulos }: Props) {
  const router = useRouter();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoria, setCategoria] = useState('');
  const [nombre, setNombre] = useState('');
  const [unidad, setUnidad] = useState('');

  function reset() { setCategoria(''); setNombre(''); setUnidad(''); setError(null); }

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/articulos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria: categoria.trim(), articulo: nombre.trim(), unidad_medida: unidad.trim() }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      setMostrarForm(false); reset(); router.refresh();
    } catch (err: any) { setError(err.message || 'Error al crear'); }
    finally { setLoading(false); }
  }

  const activos = articulos.filter((a) => a.activo === 'SI');
  const inactivos = articulos.filter((a) => a.activo !== 'SI');

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>{activos.length} activos · {inactivos.length} inactivos</p>
        {!mostrarForm && <button type="button" className="btn" onClick={() => { reset(); setMostrarForm(true); }}>+ Nuevo artículo</button>}
      </div>

      {mostrarForm && (
        <form onSubmit={crear} className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Nuevo artículo</p>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: '#dc2626' }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div><label>Nombre *</label><input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required disabled={loading} /></div>
            <div><label>Categoría *</label><input type="text" value={categoria} onChange={(e) => setCategoria(e.target.value)} required disabled={loading} /></div>
            <div><label>Unidad de medida *</label><input type="text" value={unidad} onChange={(e) => setUnidad(e.target.value)} required disabled={loading} placeholder="kg, unidad, paquete..." /></div>
          </div>
          <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#6b7280' }}>La fórmula de uso teórico se configura después, abriendo el artículo en la lista.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="btn" disabled={loading}>{loading ? 'Guardando…' : 'Crear artículo'}</button>
            <button type="button" className="btn secondary" onClick={() => { setMostrarForm(false); reset(); }} disabled={loading}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card">
        <p className="card-title">Artículos · click para editar</p>
        <table>
          <thead>
            <tr>
              <th style={{ width: '70px' }}>ID</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th style={{ textAlign: 'center', width: '60px' }}>U.</th>
              <th>Fórmula de uso teórico</th>
              <th style={{ width: '30px' }}></th>
            </tr>
          </thead>
          <tbody>
            {activos.map((a) => <ArticuloRow key={a.id_articulo} a={a} onSaved={() => router.refresh()} />)}
            {inactivos.length > 0 && (
              <>
                <tr><td colSpan={6} style={{ padding: '8px 6px 4px', fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Inactivos</td></tr>
                {inactivos.map((a) => <ArticuloRow key={a.id_articulo} a={a} onSaved={() => router.refresh()} />)}
              </>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
