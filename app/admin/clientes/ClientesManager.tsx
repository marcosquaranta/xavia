// app/admin/clientes/ClientesManager.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Cliente } from '@/lib/types';

const HOY = new Date().toISOString().split('T')[0];

const TIPOS = ['Supermercado', 'Verdulería', 'Restaurante', 'Distribuidor', 'Particular', 'Otro'];

export default function ClientesManager({ clientes }: { clientes: Cliente[] }) {
  const router = useRouter();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState(TIPOS[0]);
  const [contacto, setContacto] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [notas, setNotas] = useState('');

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre.trim(),
          tipo,
          contacto,
          telefono,
          direccion,
          notas,
          fecha_alta: HOY,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al crear');
      }
      setMostrarForm(false);
      setNombre('');
      setContacto('');
      setTelefono('');
      setDireccion('');
      setNotas('');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al crear');
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
          <button type="button" className="btn" onClick={() => setMostrarForm(true)}>
            + Nuevo cliente
          </button>
        )}
      </div>

      {mostrarForm && (
        <form onSubmit={crear} className="card">
          <p className="card-title">Nuevo cliente</p>
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
              <label>Nombre *</label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div>
              <label>Tipo *</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                disabled={loading}
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Contacto (email)</label>
              <input
                type="email"
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label>Teléfono</label>
              <input
                type="text"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                disabled={loading}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Dirección</label>
              <input
                type="text"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                disabled={loading}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Notas</label>
              <textarea
                rows={2}
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                disabled={loading}
                style={{ resize: 'vertical' }}
              />
            </div>
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
        <p className="card-title">Clientes ({clientes.length})</p>
        {clientes.length === 0 ? (
          <p
            style={{
              color: '#9ca3af',
              fontSize: '13px',
              textAlign: 'center',
              padding: '20px',
            }}
          >
            No hay clientes cargados todavía.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Contacto</th>
                <th>Teléfono</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id_cliente} style={{ opacity: c.activo === 'NO' ? 0.5 : 1 }}>
                  <td>{c.nombre}</td>
                  <td>{c.tipo}</td>
                  <td style={{ color: '#6b7280' }}>{c.contacto}</td>
                  <td style={{ color: '#6b7280' }}>{c.telefono}</td>
                  <td>
                    <span
                      className="pill"
                      style={{
                        background: c.activo === 'SI' ? '#d1fae5' : '#f3f4f6',
                        color: c.activo === 'SI' ? '#065f46' : '#6b7280',
                      }}
                    >
                      {c.activo === 'SI' ? 'Activo' : 'Inactivo'}
                    </span>
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
