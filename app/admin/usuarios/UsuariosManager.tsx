'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Usuario {
  email: string;
  nombre: string;
  rol: string;
  activo: string;
  fecha_alta: string;
}

export default function UsuariosManager({ usuarios }: { usuarios: Usuario[] }) {
  const router = useRouter();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [rol, setRol] = useState<'usuario' | 'admin'>('usuario');

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setMensaje(null);
    if (password !== confirmar) { setError('Las contraseñas no coinciden'); return; }
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/usuarios/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, nombre, password, rol }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Error');
      setMensaje(`Usuario ${email} creado correctamente`);
      setEmail(''); setNombre(''); setPassword(''); setConfirmar('');
      setMostrarForm(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al crear usuario');
    } finally {
      setLoading(false);
    }
  }

  async function toggleActivo(email: string, activo: string) {
    try {
      await fetch('/api/admin/usuarios/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, activo: activo === 'SI' ? 'NO' : 'SI' }),
      });
      router.refresh();
    } catch {}
  }

  return (
    <div>
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}
      {mensaje && <div className="alert-box success" style={{ marginBottom: '14px' }}>{mensaje}</div>}

      {/* Lista de usuarios */}
      <div className="card" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <p className="card-title" style={{ margin: 0 }}>Usuarios registrados</p>
          <button className="btn" onClick={() => setMostrarForm(!mostrarForm)}>
            {mostrarForm ? 'Cancelar' : '+ Nuevo usuario'}
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Alta</th>
              <th style={{ textAlign: 'center' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.email}>
                <td style={{ fontWeight: 500 }}>{u.nombre}</td>
                <td style={{ color: '#6b7280', fontSize: '12px' }}>{u.email}</td>
                <td>
                  <span style={{
                    background: u.rol === 'admin' ? '#fef3c7' : '#f3f4f6',
                    color: u.rol === 'admin' ? '#78350f' : '#374151',
                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500,
                  }}>
                    {u.rol}
                  </span>
                </td>
                <td style={{ color: '#9ca3af', fontSize: '12px' }}>{u.fecha_alta || '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    onClick={() => toggleActivo(u.email, u.activo)}
                    style={{
                      background: u.activo === 'SI' ? '#d1fae5' : '#fee2e2',
                      color: u.activo === 'SI' ? '#065f46' : '#7f1d1d',
                      border: 'none', borderRadius: '4px', padding: '3px 10px',
                      fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                    }}
                  >
                    {u.activo === 'SI' ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Formulario nuevo usuario */}
      {mostrarForm && (
        <form onSubmit={handleCrear} className="card">
          <p className="card-title">Crear nuevo usuario</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <div>
              <label>Nombre completo *</label>
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required disabled={loading} placeholder="Ej: Juan Pérez" />
            </div>
            <div>
              <label>Email *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading} placeholder="juan@ejemplo.com" />
            </div>
            <div>
              <label>Rol *</label>
              <select value={rol} onChange={(e) => setRol(e.target.value as 'usuario' | 'admin')} disabled={loading}>
                <option value="usuario">Usuario — puede crear y editar, NO borrar</option>
                <option value="admin">Admin — acceso completo</option>
              </select>
            </div>
            <div>
              <label>Contraseña * (mínimo 6 caracteres)</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading} />
            </div>
            <div>
              <label>Confirmar contraseña *</label>
              <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required disabled={loading} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? 'Creando…' : 'Crear usuario'}
            </button>
            <button type="button" className="btn secondary" onClick={() => setMostrarForm(false)} disabled={loading}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
