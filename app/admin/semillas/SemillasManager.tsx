// app/admin/semillas/SemillasManager.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Semilla, Variedad } from '@/lib/types';

const HOY = new Date().toISOString().split('T')[0];

export default function SemillasManager({
  semillas,
  variedades,
}: {
  semillas: Semilla[];
  variedades: Variedad[];
}) {
  const router = useRouter();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [variedad, setVariedad] = useState(variedades[0]?.variedad || '');
  const [proveedor, setProveedor] = useState('');
  const [batch, setBatch] = useState('');
  const [fechaRecepcion, setFechaRecepcion] = useState(HOY);
  const [cantidadRecibida, setCantidadRecibida] = useState(0);
  const [precioTotal, setPrecioTotal] = useState(0);
  const [notas, setNotas] = useState('');

  async function crearSemilla(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/semillas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variedad,
          proveedor,
          batch,
          fecha_recepcion: fechaRecepcion,
          cantidad_recibida: cantidadRecibida,
          precio_total: precioTotal,
          notas,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al guardar');
      }
      setMostrarForm(false);
      setProveedor('');
      setBatch('');
      setCantidadRecibida(0);
      setPrecioTotal(0);
      setNotas('');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  }

  async function toggleActivo(semilla: Semilla) {
    if (
      !confirm(
        `¿${semilla.activo === 'SI' ? 'Desactivar' : 'Reactivar'} este batch de semilla?`
      )
    )
      return;
    setLoading(true);
    try {
      await fetch('/api/admin/semillas/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_semilla: semilla.id_semilla,
          activo: semilla.activo === 'SI' ? 'NO' : 'SI',
        }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: '12px',
        }}
      >
        {!mostrarForm && (
          <button
            type="button"
            className="btn"
            onClick={() => setMostrarForm(true)}
          >
            + Nueva semilla
          </button>
        )}
      </div>

      {mostrarForm && (
        <form onSubmit={crearSemilla} className="card">
          <p className="card-title">Nueva semilla</p>
          {error && (
            <div className="alert-box error" style={{ marginBottom: '14px' }}>
              {error}
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '14px',
            }}
          >
            <div>
              <label>Variedad *</label>
              <select
                value={variedad}
                onChange={(e) => setVariedad(e.target.value)}
                required
                disabled={loading}
              >
                {variedades.map((v) => (
                  <option key={v.variedad} value={v.variedad}>
                    {v.variedad}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Proveedor *</label>
              <input
                type="text"
                value={proveedor}
                onChange={(e) => setProveedor(e.target.value)}
                placeholder="Seminis, Enza Zaden, etc."
                required
                disabled={loading}
              />
            </div>
            <div>
              <label>Código de batch *</label>
              <input
                type="text"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                placeholder="2026-04-L8"
                required
                disabled={loading}
              />
            </div>
            <div>
              <label>Fecha recepción *</label>
              <input
                type="date"
                value={fechaRecepcion}
                onChange={(e) => setFechaRecepcion(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div>
              <label>Cantidad recibida (semillas)</label>
              <input
                type="number"
                value={cantidadRecibida}
                onChange={(e) => setCantidadRecibida(Number(e.target.value))}
                min={0}
                disabled={loading}
              />
            </div>
            <div>
              <label>Precio total ($)</label>
              <input
                type="number"
                step="0.01"
                value={precioTotal}
                onChange={(e) => setPrecioTotal(Number(e.target.value))}
                min={0}
                disabled={loading}
              />
            </div>
          </div>
          <div style={{ marginTop: '14px' }}>
            <label>Notas (opcional)</label>
            <textarea
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              disabled={loading}
              style={{ resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setMostrarForm(false)}
              disabled={loading}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="card">
        <p className="card-title">Batches registrados ({semillas.length})</p>
        {semillas.length === 0 ? (
          <p
            style={{
              color: '#9ca3af',
              fontSize: '13px',
              textAlign: 'center',
              padding: '20px',
            }}
          >
            No hay batches cargados todavía. Agregá el primero con "+ Nueva semilla".
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Variedad</th>
                <th>Proveedor</th>
                <th>Recibido</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {semillas.map((s) => (
                <tr key={s.id_semilla} style={{ opacity: s.activo === 'NO' ? 0.5 : 1 }}>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{s.batch}</td>
                  <td>{s.variedad}</td>
                  <td>{s.proveedor}</td>
                  <td style={{ color: '#6b7280' }}>{s.fecha_recepcion}</td>
                  <td style={{ textAlign: 'right' }}>
                    {s.cantidad_recibida ? Number(s.cantidad_recibida).toLocaleString('es-AR') : '-'}
                  </td>
                  <td>
                    <span
                      className="pill"
                      style={{
                        background: s.activo === 'SI' ? '#d1fae5' : '#f3f4f6',
                        color: s.activo === 'SI' ? '#065f46' : '#6b7280',
                      }}
                    >
                      {s.activo === 'SI' ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => toggleActivo(s)}
                      disabled={loading}
                    >
                      {s.activo === 'SI' ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
