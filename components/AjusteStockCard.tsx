'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { CultivoCamara } from '@/lib/camara';

interface CultivoStock { actual: number; ajusteMes: number }

export default function AjusteStockCard({ rucula, lechugaCrespa, lechugaRoble, ventasHoyYaDescontadas }: {
  rucula: CultivoStock; lechugaCrespa: CultivoStock; lechugaRoble: CultivoStock; ventasHoyYaDescontadas: boolean;
}) {
  const [abierto, setAbierto] = useState<CultivoCamara | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [descarte, setDescarte] = useState('');
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
    setAbierto(key); setCantidad(''); setDescarte(''); setNotas(''); setMsg(null);
  }
  function cerrar() {
    setAbierto(null); setCantidad(''); setDescarte(''); setNotas('');
  }

  async function registrar() {
    if (!abierto || cantidad === '') return;
    setLoading(true); setMsg(null);
    try {
      const r = await fetch('/api/stocks/camara/base', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cultivo: abierto, fecha: new Date().toISOString().slice(0, 10),
          tipo: 'ajuste', cantidad_paq: Number(cantidad), descarte_paq: Number(descarte) || 0, notas,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error al guardar');
      const dTxt = diff === null || diff === 0 ? 'sin diferencia vs. lo esperado' : `${diff > 0 ? '+' : ''}${diff} paq vs. lo esperado`;
      const descTxt = Number(descarte) > 0 ? `, ${Number(descarte)} paq de descarte` : '';
      setMsg({ t: 'ok', s: `Ajuste registrado (${dTxt}${descTxt}). Recargando…` });
      setTimeout(() => window.location.reload(), 1600);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al guardar' });
      setLoading(false);
    }
  }

  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px' }}>
      {/* Header con ícono + título en mayúsculas — mismo lenguaje visual que el resto de
          las tarjetas de Indicadores (Ventas, Ciclos, Pesos, Producción, Ocupación). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{ fontSize: '14px' }}>🧊</span>
        <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: '#0e7490', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Stock en cámara</p>
      </div>
      {/* Misma aclaración que "Disp. para venta" en Ventas — el stock ya sale de
          calcularCamara() con la misma regla del mediodía, así que la ambigüedad de si
          cuenta o no las ventas de hoy es exactamente la misma acá. */}
      <p style={{ margin: '0 0 9px', fontSize: '10px', color: ventasHoyYaDescontadas ? '#166534' : '#b45309', fontWeight: 600 }}>
        {ventasHoyYaDescontadas ? 'Ya cuenta las ventas de hoy' : 'No cuenta las ventas de hoy todavía'} <span style={{ color: '#9ca3af', fontWeight: 400 }}>(regla del mediodía)</span>
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {cultivos.map(c => (
          <div key={c.key} style={{ background: '#fafafa', border: '1px solid #f1f0eb', borderRadius: '8px', padding: '9px 11px' }}>
            <span style={{ fontSize: '10.5px', color: c.color, fontWeight: 700, textTransform: 'uppercase' }}>{c.label}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', margin: '2px 0 6px' }}>
              <strong style={{ fontSize: '18px', color: '#111827', fontWeight: 800, lineHeight: 1 }}>{c.data.actual}</strong>
              <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>paq</span>
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: c.data.ajusteMes === 0 ? '#9ca3af' : c.data.ajusteMes > 0 ? '#059669' : '#dc2626' }}>
                {c.data.ajusteMes > 0 ? '↑' : c.data.ajusteMes < 0 ? '↓' : '·'} {Math.abs(c.data.ajusteMes)} paq <span style={{ fontWeight: 400, color: '#9ca3af' }}>dif. acum. mes</span>
              </span>
            </div>
            <Link href={`/stocks/${c.key}`} style={{ display: 'inline-block', marginBottom: '8px', fontSize: '11px', color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
              Ver detalle →
            </Link>

            {abierto === c.key ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <input type="number" placeholder="Cantidad real (paq)" value={cantidad} onChange={e => setCantidad(e.target.value)} disabled={loading}
                  style={{ fontSize: '12px', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '5px' }} />
                {diff !== null && (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: diff === 0 ? '#6b7280' : diff > 0 ? '#059669' : '#dc2626' }}>
                    {diff === 0 ? 'Sin diferencia' : `${diff > 0 ? '+' : ''}${diff} paq vs. lo esperado`}
                  </span>
                )}
                <input type="number" placeholder="Descarte en cámara (paq, opcional)" value={descarte} onChange={e => setDescarte(e.target.value)} disabled={loading}
                  title="Cuánto de la diferencia es producto que se tira (podrido, pasado) — queda registrado como descarte en cámara"
                  style={{ fontSize: '12px', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '5px' }} />
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
            )}
          </div>
        ))}
      </div>
      {msg && (
        <p style={{ margin: '8px 0 0', fontSize: '11px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>
      )}
    </div>
  );
}
