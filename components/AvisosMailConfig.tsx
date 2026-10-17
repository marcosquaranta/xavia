'use client';
import { useState } from 'react';
import type { AvisoConfigurable } from '@/lib/avisosConfig';

export default function AvisosMailConfig({ avisos }: {
  avisos: (AvisoConfigurable & { valorActual: string; usandoDefault: boolean })[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {avisos.map((a) => <FilaAviso key={a.clave} aviso={a} />)}
    </div>
  );
}

function FilaAviso({ aviso }: { aviso: AvisoConfigurable & { valorActual: string; usandoDefault: boolean } }) {
  const [valor, setValor] = useState(aviso.valorActual);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [porDefecto, setPorDefecto] = useState(aviso.usandoDefault);

  async function guardar() {
    setGuardando(true); setMsg(null);
    try {
      const r = await fetch('/api/admin/avisos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave: aviso.clave, valor }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error al guardar');
      setPorDefecto(!!j.usandoDefault);
      setMsg({ t: 'ok', s: `✓ Guardado. Le va a llegar a ${(j.vigentes || []).join(', ')}.` });
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al guardar' });
    }
    setGuardando(false);
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px' }}>
      <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 700, color: '#111827' }}>{aviso.titulo}</p>
      <p style={{ margin: '0 0 9px', fontSize: '11.5px', color: '#6b7280', lineHeight: 1.45 }}>{aviso.descripcion}</p>
      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" value={valor} onChange={(e) => setValor(e.target.value)} disabled={guardando}
          placeholder={aviso.porDefecto.join(', ')}
          style={{ flex: '1 1 280px', minWidth: '220px', fontSize: '12.5px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px' }} />
        <button onClick={guardar} disabled={guardando}
          style={{ fontSize: '12px', fontWeight: 700, padding: '6px 14px', background: '#166534', color: 'white', border: 'none', borderRadius: '6px', cursor: guardando ? 'default' : 'pointer', opacity: guardando ? 0.6 : 1 }}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {/* Vaciar el campo no apaga el aviso: lo devuelve al destinatario por defecto. Decirlo
          acá evita el malentendido de borrar para "dejar de recibirlo" y que siga llegando. */}
      <p style={{ margin: '6px 0 0', fontSize: '10.5px', color: '#9ca3af' }}>
        Varios separados por coma. Si lo dejás vacío vuelve al de siempre: <strong>{aviso.porDefecto.join(', ')}</strong>.
        {porDefecto && ' Ahora mismo está usando ese.'}
      </p>
      {msg && (
        <p style={{ margin: '6px 0 0', fontSize: '11.5px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>
      )}
    </div>
  );
}
