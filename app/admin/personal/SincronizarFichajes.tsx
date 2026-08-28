'use client';
import { useState } from 'react';

// Dispara a mano la sincronización de un rango contra CrossChex (el mismo endpoint que
// corre el cron diario). Hace falta para quincenas viejas, anteriores a que existiera la
// caché, o si una corrida del cron falló. Es lento a propósito: CrossChex admite 1 pedido
// cada 15 segundos, así que un rango de una quincena puede tardar más de un minuto.
export default function SincronizarFichajes({ desde, hasta, dias }: { desde: string; hasta: string; dias: string[] }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  async function sincronizar() {
    setLoading(true); setMsg(null);
    try {
      const r = await fetch(`/api/cron/crosschex-diario?desde=${desde}&hasta=${hasta}`);
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Error al sincronizar');
      setMsg({ t: 'ok', s: `✓ ${j.fichajes} fichajes guardados (${j.dias} días). Recargando…` });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al sincronizar' });
      setLoading(false);
    }
  }

  return (
    <div className="alert-box" style={{ marginBottom: '14px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '13px' }}>
        Faltan fichajes de {dias.length} día{dias.length !== 1 ? 's' : ''} de esta quincena
      </p>
      <p style={{ margin: '0 0 8px', fontSize: '12px' }}>
        Los fichajes se guardan una vez por día (10hs) desde CrossChex. Estos días todavía no están guardados,
        así que las horas y tardanzas de abajo están incompletas: {dias.slice(0, 8).join(' · ')}{dias.length > 8 ? ` · +${dias.length - 8} más` : ''}
      </p>
      <button onClick={sincronizar} disabled={loading} className="btn secondary" style={{ fontSize: '12px' }}>
        {loading ? 'Sincronizando… (puede tardar más de un minuto)' : 'Traer estos días de CrossChex'}
      </button>
      {msg && <p style={{ margin: '8px 0 0', fontSize: '12px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>}
    </div>
  );
}
