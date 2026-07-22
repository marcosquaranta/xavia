'use client';
import { useState } from 'react';
import type { CultivoCamara } from '@/lib/camara';

interface CultivoStock { actual: number; ajusteMes: number }

export default function AjusteStockCard({ rucula, lechugaCrespa, lechugaRoble, esAdmin }: {
  rucula: CultivoStock; lechugaCrespa: CultivoStock; lechugaRoble: CultivoStock; esAdmin: boolean;
}) {
  const [abierto, setAbierto] = useState<CultivoCamara | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  const cultivos = [
    { key: 'rucula' as const, label: 'Rúcula', color: '#134e4a', data: rucula },
    { key: 'lechuga_crespa' as const, label: 'Lechuga Crespa', color: '#84cc16', data: lechugaCrespa },
    { key: 'lechuga_roble' as const, label: 'Lechuga Hoja de Roble', color: '#4d7c0f', data: lechugaRoble },
  ];
  const stockAbierto = abierto ? cultivos.find(c => c.key === abierto)!.data.actual : 0;
  const diff = abierto && cantidad !== '' ? Math.round(Number(cantidad) - stockAbierto) : null;

  function abrir(key: CultivoCamara) {
    setAbierto(key); setCantidad(''); setNotas(''); setMsg(null);
  }
  function cerrar() {
    setAbierto(null); setCantidad(''); setNotas('');
  }

  async function registrar() {
    if (!abierto || cantidad === '') return;
    setLoading(true); setMsg(null);
    try {
      const r = await fetch('/api/stocks/camara/base', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cultivo: abierto, fecha: new Date().toISOString().slice(0, 10),
          tipo: 'ajuste', cantidad_paq: Number(cantidad), notas,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error al guardar');
      const dTxt = diff === null || diff === 0 ? 'sin diferencia vs. lo esperado' : `${diff > 0 ? '+' : ''}${diff} paq vs. lo esperado`;
      setMsg({ t: 'ok', s: `Ajuste registrado (${dTxt}). Recargando…` });
      setTimeout(() => window.location.reload(), 1600);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al guardar' });
      setLoading(false);
    }
  }

  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px' }}>
      <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: '#111827' }}>Stock en cámara</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
        {cultivos.map(c => (
          <div key={c.key} style={{ background: '#fafafa', border: '1px solid #f1f0eb', borderRadius: '8px', padding: '10px 12px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: c.color, textTransform: 'uppercase' }}>{c.label}</p>
            <p style={{ margin: '0 0 2px', fontSize: '20px', fontWeight: 800, color: '#111827' }}>
              {c.data.actual} <span style={{ fontSize: '11px', fontWeight: 400, color: '#9ca3af' }}>paq</span>
            </p>
            <p style={{ margin: '0 0 8px', fontSize: '11px', color: c.data.ajusteMes === 0 ? '#9ca3af' : c.data.ajusteMes > 0 ? '#059669' : '#dc2626' }}>
              Dif. acumulada mes: {c.data.ajusteMes > 0 ? '+' : ''}{c.data.ajusteMes} paq
            </p>

            {esAdmin && (abierto === c.key ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <input type="number" placeholder="Cantidad real (paq)" value={cantidad} onChange={e => setCantidad(e.target.value)} disabled={loading}
                  style={{ fontSize: '12px', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '5px' }} />
                {diff !== null && (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: diff === 0 ? '#6b7280' : diff > 0 ? '#059669' : '#dc2626' }}>
                    {diff === 0 ? 'Sin diferencia' : `${diff > 0 ? '+' : ''}${diff} paq vs. lo esperado`}
                  </span>
                )}
                <input type="text" placeholder="Notas (opcional)" value={notas} onChange={e => setNotas(e.target.value)} disabled={loading}
                  style={{ fontSize: '12px', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '5px' }} />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={registrar} disabled={loading || cantidad === ''}
                    style={{ fontSize: '11px', padding: '4px 10px', background: '#166534', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', opacity: loading || cantidad === '' ? 0.6 : 1 }}>
                    {loading ? 'Guardando…' : 'Confirmar'}
                  </button>
                  <button onClick={cerrar} disabled={loading}
                    style={{ fontSize: '11px', padding: '4px 10px', background: '#f3f4f6', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => abrir(c.key)}
                style={{ fontSize: '11px', padding: '4px 10px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '5px', cursor: 'pointer', color: '#374151' }}>
                Registrar ajuste
              </button>
            ))}
          </div>
        ))}
      </div>
      {msg && (
        <p style={{ margin: '8px 0 0', fontSize: '11px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>
      )}
    </div>
  );
}
