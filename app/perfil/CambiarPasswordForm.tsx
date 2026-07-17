'use client';
import { useState } from 'react';

export default function CambiarPasswordForm() {
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setMensaje(null);
    if (passwordNueva !== confirmar) { setError('Las contraseñas nuevas no coinciden'); return; }
    if (passwordNueva.length < 6) { setError('La contraseña nueva debe tener al menos 6 caracteres'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/cambiar-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passwordActual, passwordNueva }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Error');
      setMensaje('Contraseña actualizada correctamente.');
      setPasswordActual(''); setPasswordNueva(''); setConfirmar('');
    } catch (err: any) {
      setError(err.message || 'No se pudo cambiar la contraseña');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ maxWidth: '420px' }}>
      <p className="card-title">Cambiar contraseña</p>
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}
      {mensaje && <div className="alert-box success" style={{ marginBottom: '14px' }}>{mensaje}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label>Contraseña actual *</label>
          <input type="password" value={passwordActual} onChange={(e) => setPasswordActual(e.target.value)} required disabled={loading} />
        </div>
        <div>
          <label>Contraseña nueva * (mínimo 6 caracteres)</label>
          <input type="password" value={passwordNueva} onChange={(e) => setPasswordNueva(e.target.value)} required disabled={loading} />
        </div>
        <div>
          <label>Confirmar contraseña nueva *</label>
          <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required disabled={loading} />
        </div>
      </div>
      <div style={{ marginTop: '16px' }}>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Guardando…' : 'Guardar nueva contraseña'}
        </button>
      </div>
    </form>
  );
}
