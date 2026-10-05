'use client';
import { useState } from 'react';

// Manda el informe del cierre por mail, cuando Marcos decide que el mes está cargado.
//
// A pedido y no automático: el cierre es manual —resumen de la tarjeta, stocks finales,
// saldos reales, previsiones— y un mail por cron llegaría siempre antes de que esté todo,
// mostrando un mes incompleto como si fuera el cierre.
export default function EnviarInforme({ anio, mes, label }: { anio: number; mes: number; label: string }) {
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'ok' | 'error'>('listo');
  const [error, setError] = useState('');

  async function enviar() {
    setEstado('enviando'); setError('');
    try {
      const res = await fetch('/api/eerr/informe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anio, mes }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setEstado('error'); setError(j.error || `HTTP ${res.status}`); return; }
      setEstado('ok');
    } catch (e: any) {
      setEstado('error'); setError(e?.message || 'No se pudo enviar');
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <button onClick={enviar} disabled={estado === 'enviando'}
        style={{
          padding: '7px 13px', fontSize: '13px', borderRadius: '7px', cursor: estado === 'enviando' ? 'default' : 'pointer',
          border: '1px solid #e5e7eb', background: '#fff', fontWeight: 600,
        }}>
        {estado === 'enviando' ? 'Enviando…' : `✉️ Mandarme el cierre de ${label}`}
      </button>
      {/* El mes se puede mandar más de una vez a propósito: se corrige un gasto y se manda de
          nuevo. Así que el botón no se bloquea después de enviar, solo confirma. */}
      {estado === 'ok' && <span style={{ fontSize: '12.5px', color: '#059669', fontWeight: 600 }}>Enviado · se puede volver a mandar si corregís algo</span>}
      {estado === 'error' && <span style={{ fontSize: '12.5px', color: '#dc2626' }}>No se pudo enviar: {error}</span>}
    </div>
  );
}
