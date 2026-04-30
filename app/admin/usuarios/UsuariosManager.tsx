// app/admin/usuarios/UsuariosManager.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface UsuarioSinHash {
  email: string;
  rol: 'admin' | 'usuario';
  nombre: string;
  activo: 'SI' | 'NO';
  fecha_alta: string;
}

const HOY = new Date().toISOString().split('T')[0];

export default function UsuariosManager({
  usuarios,
  miEmail,
}: {
  usuarios: UsuarioSinHash[];
  miEmail: string;
}) {
  const router = useRouter();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contraseñaTemporal, setContraseñaTemporal] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<'admin' | 'usuario'>('usuario');
  const [password, setPassword] = useState('');

  async function crearUsuario(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setContraseñaTemporal(null);
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          nombre: nombre.trim(),
          rol,
          password,
          fecha_alta: HOY,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al crear usuario');
      }
      setContraseñaTemporal(password);
      setMostrarForm(false);
      setEmail('');
      setNombre('');
      setPassword('');
      setRol('usuario');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al crear usuario');
    } finally {
      setLoading(false);
    }
  }

  async function toggleActivo(u: UsuarioSinHash) {
    if (u.email === miEmail) {
      alert('No podés desactivarte a vos mismo');
      return;
    }
    if (!confirm(`¿${u.activo === 'SI' ? 'Desactivar' : 'Reactivar'} a ${u.nombre}?`)) {
      return;
    }
    setLoading(true);
    try {
      await fetch('/api/admin/usuarios/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: u.email,
          activo: u.activo === 'SI' ? 'NO' : 'SI',
        }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  function generarPasswordAleatoria() {
    const chars =
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let pass = '';
    for (let i = 0; i < 10; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(pass);
  }

  return (
    <>
      {contraseñaTemporal && (
        <div className="alert-box success" style={{ marginBottom: '14px' }}>
          <strong>Usuario creado correctamente.</strong>
          <br />
          Compartile la contraseña al usuario:{' '}
          <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px' }}>
            {contraseñaTemporal}
          </code>
          <br />
          <span style={{ fontSize: '11px' }}>
            Esta contraseña no se va a volver a mostrar. Anotala antes de cerrar.
          </span>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: '12px',
        }}
      >
        {!mostrarForm && (
          <button type="button" className="btn" onClick={() => setMostrarForm(true)}>
            + Nuevo usuario
          </button>
        )}
      </div>

      {mostrarForm && (
        <form onSubmit={crearUsuario} className="card">
          <p className="card-title">Nuevo usuario</p>
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
              <label>Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div>
              <label>Rol *</label>
              <select
                value={rol}
                onChange={(e) => setRol(e.target.value as 'admin' | 'usuario')}
                disabled={loading}
              >
                <option value="usuario">Usuario</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label>Contraseña *</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={generarPasswordAleatoria}
                  disabled={loading}
                >
                  Generar
                </button>
              </div>
              <p style={{ fontSize: '11px', color: '#9ca3af', margin: '4px 0 0' }}>
                Compartila al usuario por un canal seguro. Ellos no pueden cambiarla por
                ahora.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? 'Guardando…' : 'Crear usuario'}
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
        <p className="card-title">Usuarios ({usuarios.length})</p>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Alta</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.email} style={{ opacity: u.activo === 'NO' ? 0.5 : 1 }}>
                <td>
                  {u.nombre}
                  {u.email === miEmail && (
                    <span
                      style={{
                        fontSize: '11px',
                        marginLeft: '6px',
                        color: '#059669',
                        fontWeight: 500,
                      }}
                    >
                      (vos)
                    </span>
                  )}
                </td>
                <td style={{ color: '#6b7280' }}>{u.email}</td>
                <td>
                  <span
                    className={`pill ${u.rol === 'admin' ? 'fase2' : 'fase1'}`}
                  >
                    {u.rol}
                  </span>
                </td>
                <td style={{ color: '#6b7280', fontSize: '11px' }}>{u.fecha_alta}</td>
                <td>
                  <span
                    className="pill"
                    style={{
                      background: u.activo === 'SI' ? '#d1fae5' : '#f3f4f6',
                      color: u.activo === 'SI' ? '#065f46' : '#6b7280',
                    }}
                  >
                    {u.activo === 'SI' ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  {u.email !== miEmail && (
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => toggleActivo(u)}
                      disabled={loading}
                    >
                      {u.activo === 'SI' ? 'Desactivar' : 'Reactivar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
