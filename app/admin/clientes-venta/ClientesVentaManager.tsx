'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClienteVenta, PrecioVenta } from '@/lib/types';

interface Props {
  clientes: ClienteVenta[];
  precios: PrecioVenta[];
}

export default function ClientesVentaManager({ clientes, precios }: Props) {
  const router = useRouter();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const [nombreXubio, setNombreXubio] = useState('');
  const [alias, setAlias] = useState('');
  const [tipoFactura, setTipoFactura] = useState('B');
  const [puntoVenta, setPuntoVenta] = useState('2');
  const [pRucula, setPRucula] = useState('');
  const [pLechuga, setPLechuga] = useState('');
  const [pHojaRoble, setPHojaRoble] = useState('');
  const [pBandeja, setPBandeja] = useState('');
  const [pAlbahaca, setPAlbahaca] = useState('');

  function reset() {
    setNombreXubio(''); setAlias(''); setTipoFactura('B'); setPuntoVenta('2');
    setPRucula(''); setPLechuga(''); setPHojaRoble(''); setPBandeja(''); setPAlbahaca('');
    setError(null); setOk(false);
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setOk(false);
    try {
      const res = await fetch('/api/admin/clientes-venta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre_xubio: nombreXubio.trim(),
          alias: alias.trim(),
          tipo_factura: tipoFactura,
          punto_venta: puntoVenta,
          precios: {
            rucula: Number(pRucula) || 0,
            lechuga_crespa: Number(pLechuga) || 0,
            hoja_roble: Number(pHojaRoble) || 0,
            bandeja_rucula: Number(pBandeja) || 0,
            albahaca: Number(pAlbahaca) || 0,
          },
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al crear');
      }
      setOk(true);
      setMostrarForm(false);
      reset();
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al crear');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>{clientes.length} clientes de facturación</p>
        {!mostrarForm && (
          <button type="button" className="btn" onClick={() => { reset(); setMostrarForm(true); }}>
            + Nuevo cliente
          </button>
        )}
      </div>

      {ok && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#166534' }}>
          ✓ Cliente creado correctamente
        </div>
      )}

      {mostrarForm && (
        <form onSubmit={crear} className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Nuevo cliente de ventas</p>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: '#dc2626' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Nombre en Xubio *</label>
              <input type="text" value={nombreXubio} onChange={e => setNombreXubio(e.target.value)} required disabled={loading} placeholder="Ej: GARCIA JUAN" />
            </div>
            <div>
              <label>Alias / referencia</label>
              <input type="text" value={alias} onChange={e => setAlias(e.target.value)} disabled={loading} placeholder="Ej: Pablito Verduleria" />
            </div>
            <div>
              <label>Tipo de factura *</label>
              <select value={tipoFactura} onChange={e => setTipoFactura(e.target.value)} disabled={loading}>
                <option value="A">A</option>
                <option value="B">B</option>
              </select>
            </div>
            <div>
              <label>Punto de venta *</label>
              <input type="number" value={puntoVenta} onChange={e => setPuntoVenta(e.target.value)} required disabled={loading} />
            </div>
          </div>

          <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Precios</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            {[
              { label: 'Rúcula', val: pRucula, set: setPRucula },
              { label: 'Lechuga Crespa', val: pLechuga, set: setPLechuga },
              { label: 'Hoja de Roble', val: pHojaRoble, set: setPHojaRoble },
              { label: 'Bandeja Rúcula', val: pBandeja, set: setPBandeja },
              { label: 'Albahaca', val: pAlbahaca, set: setPAlbahaca },
            ].map(({ label, val, set }) => (
              <div key={label}>
                <label>{label}</label>
                <input type="number" value={val} onChange={e => set(e.target.value)} disabled={loading} placeholder="0" min="0" />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button type="submit" className="btn" disabled={loading}>{loading ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn secondary" onClick={() => { setMostrarForm(false); reset(); }} disabled={loading}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card">
        <p className="card-title">Clientes de facturación</p>
        {clientes.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Sin clientes cargados.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'center' }}>ID</th>
                <th>Nombre Xubio</th>
                <th>Alias</th>
                <th style={{ textAlign: 'center' }}>Fact.</th>
                <th style={{ textAlign: 'right' }}>Rúcula</th>
                <th style={{ textAlign: 'right' }}>Lechuga</th>
                <th style={{ textAlign: 'center' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map(c => {
                const p = precios.find(pr => String(pr.id_control) === String(c.id_control));
                return (
                  <tr key={c.id_control} style={{ opacity: c.activo === 'NO' ? 0.5 : 1 }}>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#6b7280' }}>{c.id_control}</td>
                    <td style={{ fontWeight: 500 }}>{c.nombre_xubio}</td>
                    <td style={{ color: '#6b7280', fontSize: '12px' }}>{c.alias}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ background: c.tipo_factura === 'A' ? '#dbeafe' : '#f3f4f6', color: c.tipo_factura === 'A' ? '#1e40af' : '#374151', padding: '1px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                        {c.tipo_factura}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '12px' }}>{p ? `$${Number(p.rucula).toLocaleString('es-AR')}` : '—'}</td>
                    <td style={{ textAlign: 'right', fontSize: '12px' }}>{p ? `$${Number(p.lechuga_crespa).toLocaleString('es-AR')}` : '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="pill" style={{ background: c.activo === 'SI' ? '#d1fae5' : '#f3f4f6', color: c.activo === 'SI' ? '#065f46' : '#6b7280' }}>
                        {c.activo === 'SI' ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
