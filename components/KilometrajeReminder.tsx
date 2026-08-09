'use client';
import { useState } from 'react';

export default function KilometrajeReminder({ ultimoKm, ultimaFecha }: { ultimoKm: number | null; ultimaFecha: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const [km, setKm] = useState('');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  async function registrar() {
    if (!(Number(km) > 0)) { setMsg({ t: 'err', s: 'Ingresá el kilometraje.' }); return; }
    setLoading(true); setMsg(null);
    try {
      const res = await fetch('/api/kilometraje', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: new Date().toISOString().slice(0, 10), km_acumulado: km, notas }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Error al guardar');
      setMsg({ t: 'ok', s: '✓ Kilometraje registrado. Recargando…' });
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al guardar' });
      setLoading(false);
    }
  }

  return (
    <div style={{ background: '#eff6ff', border: '2px solid #3b82f6', borderRadius: '10px', padding: '16px 18px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '28px', lineHeight: 1 }}>🚗</span>
        <div style={{ flex: 1, minWidth: '260px' }}>
          <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 800, color: '#1e3a8a' }}>Falta cargar el kilometraje del Partner esta semana</p>
          <p style={{ margin: 0, fontSize: '12.5px', color: '#1e40af' }}>
            Se pide todos los sábados, para ver los km recorridos por semana en Estadísticas.
            {ultimoKm !== null && <> Última carga: <strong>{ultimoKm.toLocaleString('es-AR')} km</strong>{ultimaFecha ? ` (${ultimaFecha})` : ''}.</>}
          </p>
        </div>
        {!abierto && (
          <button onClick={() => setAbierto(true)} className="btn secondary" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
            Cargar ahora
          </button>
        )}
      </div>
      {abierto && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #bfdbfe', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: '10px', color: '#1e3a8a' }}>Kilometraje acumulado actual</label>
            <input type="number" min={ultimoKm ?? 0} step={1} value={km} onChange={(e) => setKm(e.target.value)}
              placeholder={ultimoKm !== null ? String(ultimoKm) : 'ej: 45210'} style={{ width: '130px', fontSize: '13px', padding: '6px 8px' }} disabled={loading} autoFocus />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: '#1e3a8a' }}>Notas (opcional)</label>
            <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} style={{ width: '200px', fontSize: '13px', padding: '6px 8px' }} disabled={loading} />
          </div>
          <button onClick={registrar} disabled={loading} className="btn" style={{ fontSize: '12px', padding: '7px 14px' }}>
            {loading ? 'Guardando…' : '✓ Registrar'}
          </button>
          <button onClick={() => setAbierto(false)} className="btn secondary" style={{ fontSize: '12px', padding: '7px 14px' }} disabled={loading}>
            Cancelar
          </button>
        </div>
      )}
      {msg && <p style={{ margin: '8px 0 0', fontSize: '12px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>}
    </div>
  );
}
