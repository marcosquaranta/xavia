'use client';
import { useState } from 'react';

export default function KilometrajeReminder({ ultimoKm, ultimaFecha, ultimoIdKm, faltaCargar }: {
  ultimoKm: number | null; ultimaFecha: string | null; ultimoIdKm: string | null; faltaCargar: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [km, setKm] = useState('');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [corrigiendo, setCorrigiendo] = useState(false);

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

  // Si te equivocaste al cargar (ej. faltó un dígito), la única forma de cargar un número
  // MENOR es borrar esa última carga primero — el odómetro no puede "retroceder" para
  // cualquier otro caso, a propósito (para agarrar errores de tipeo).
  async function borrarUltima() {
    if (!ultimoIdKm) return;
    setLoading(true); setMsg(null);
    try {
      const res = await fetch('/api/kilometraje', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_km: ultimoIdKm }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Error al borrar');
      setMsg({ t: 'ok', s: '✓ Carga borrada. Recargando para volver a cargar…' });
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al borrar' });
      setLoading(false);
    }
  }

  // Ya se cargó algo esta semana (no falta) — solo mostrar una línea chica con la opción
  // de corregir por si el número cargado estuvo mal, sin el banner grande de recordatorio.
  if (!faltaCargar) {
    if (ultimoKm === null) return null;
    return (
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 14px', marginBottom: '14px', fontSize: '12px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span>🚗 Última carga de km del Partner: <strong>{ultimoKm.toLocaleString('es-AR')} km</strong>{ultimaFecha ? ` (${ultimaFecha})` : ''}.</span>
        {!corrigiendo ? (
          <button onClick={() => setCorrigiendo(true)} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
            ¿Cargaste mal? Corregir
          </button>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Borrar esta carga y volver a cargar el número correcto:</span>
            <button onClick={borrarUltima} disabled={loading} className="btn secondary" style={{ fontSize: '11px', padding: '3px 10px', color: '#dc2626', borderColor: '#fecaca' }}>
              {loading ? 'Borrando…' : 'Borrar última carga'}
            </button>
            <button onClick={() => setCorrigiendo(false)} disabled={loading} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '12px', cursor: 'pointer', padding: 0 }}>
              Cancelar
            </button>
          </span>
        )}
        {msg && <span style={{ fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</span>}
      </div>
    );
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
