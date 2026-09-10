'use client';
import { useState } from 'react';
import {
  CONFIG_ACTIVO, CONFIG_AFITAL_ANCLA, CONFIG_SERENADE_DIAS, CONFIG_SERENADE_ANCLA,
  type ConfigProtocolo,
} from '@/lib/protocoloTareas';

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};
const labelStyle: React.CSSProperties = { fontSize: '10.5px', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: '2px' };

// Los dos parámetros que la especificación de Marcelo pide dejar editables (el ancla del
// ciclo de 14 días de Afital y la frecuencia de Serenade, que pasa de 30 a 15 días al
// entrar el verano) más el interruptor para apagar todo fuera de temporada.
export default function ProtocoloConfig({ cfg }: { cfg: ConfigProtocolo }) {
  const [afitalAncla, setAfitalAncla] = useState(cfg.afitalAncla || '');
  const [serenadeDias, setSerenadeDias] = useState(String(cfg.serenadeDias));
  const [serenadeAncla, setSerenadeAncla] = useState(cfg.serenadeAncla || '');
  const [activo, setActivo] = useState(cfg.activo);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  async function guardar(extra?: Record<string, any>) {
    setLoading(true); setMsg(null);
    try {
      const res = await fetch('/api/protocolo/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [CONFIG_AFITAL_ANCLA]: afitalAncla,
          [CONFIG_SERENADE_DIAS]: serenadeDias,
          [CONFIG_SERENADE_ANCLA]: serenadeAncla,
          [CONFIG_ACTIVO]: activo ? 'SI' : 'NO',
          ...extra,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Error al guardar');
      setMsg({ t: 'ok', s: '✓ Guardado. Recargando…' });
      setTimeout(() => window.location.reload(), 1000);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al guardar' });
      setLoading(false);
    }
  }

  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px' }}>
      <p style={{ margin: '0 0 3px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700 }}>
        Configuración del protocolo
      </p>
      <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#9ca3af' }}>
        Solo admin. El ciclo de 14 días de Afital se cuenta desde el primer miércoles que definas acá; Serenade, desde su primera aplicación.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '10px' }}>
        <div>
          <label style={labelStyle}>Primer miércoles de Afital</label>
          <input type="date" value={afitalAncla} onChange={(e) => setAfitalAncla(e.target.value)} disabled={loading} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Serenade cada… (días)</label>
          <input type="number" min={1} value={serenadeDias} onChange={(e) => setSerenadeDias(e.target.value)} disabled={loading} style={inputStyle} />
          <span style={{ fontSize: '10px', color: '#9ca3af' }}>30 en primavera · 15 en verano</span>
        </div>
        <div>
          <label style={labelStyle}>Primera aplicación de Serenade</label>
          <input type="date" value={serenadeAncla} onChange={(e) => setSerenadeAncla(e.target.value)} disabled={loading} style={inputStyle} />
          <span style={{ fontSize: '10px', color: '#9ca3af' }}>Después se recalcula sola desde la última</span>
        </div>
        <div>
          <label style={labelStyle}>Protocolo</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#374151', paddingTop: '4px' }}>
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} disabled={loading} />
            Activo esta temporada
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => guardar()} disabled={loading}
          style={{ fontSize: '11.5px', padding: '5px 13px', background: '#166534', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Guardando…' : 'Guardar configuración'}
        </button>
        {msg && <span style={{ fontSize: '11px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</span>}
      </div>
    </div>
  );
}
