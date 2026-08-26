'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ResultadoCamara } from '@/lib/camara';

interface Props {
  rucula: ResultadoCamara;
  lechugaCrespa: ResultadoCamara;
  lechugaRoble: ResultadoCamara;
  albahaca: ResultadoCamara;
  valorizacionActual: number;
}

function SemaforoDias({ dias }: { dias: number }) {
  const color = dias > 7 ? '#dc2626' : dias > 4 ? '#d97706' : '#059669';
  const bg    = dias > 7 ? '#fef2f2' : dias > 4 ? '#fffbeb' : '#f0fdf4';
  return (
    <span style={{ background: bg, color, padding: '2px 8px', borderRadius: '5px', fontSize: '12px', fontWeight: 700 }}>
      {dias}d en cámara {dias > 7 ? '🔴' : dias > 4 ? '🟡' : '🟢'}
    </span>
  );
}

function CardCamara({ datos, cultivo, cultivoKey, onSaved }: {
  datos: ResultadoCamara; cultivo: string; cultivoKey: string; onSaved: () => void;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [tipo, setTipo] = useState<'inicial' | 'ajuste'>('ajuste');
  const [cantidad, setCantidad] = useState('');
  const [descarte, setDescarte] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/stocks/camara/base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cultivo: datos.cultivo, fecha, tipo, cantidad_paq: Number(cantidad), descarte_paq: Number(descarte) || 0, notas }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      setMostrarForm(false); setCantidad(''); setDescarte(''); setNotas('');
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const colorTop = datos.cultivo === 'rucula' ? '#134e4a' : datos.cultivo === 'lechuga_crespa' ? '#84cc16' : '#4d7c0f';

  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderTop: `3px solid ${colorTop}`, borderRadius: '10px', padding: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ background: colorTop, color: 'white', padding: '1px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 800 }}>
          {cultivo.toUpperCase()}
        </span>
        <span style={{ fontSize: '9px', color: '#9ca3af' }}>Stock en cámara</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '4px' }}>
        <span style={{ fontSize: '26px', fontWeight: 800, color: '#111827', lineHeight: 1 }}>{datos.stockActual.toLocaleString('es-AR')}</span>
        <span style={{ fontSize: '11px', color: '#6b7280' }}>paq.</span>
      </div>

      {datos.stockActual > 0 && <SemaforoDias dias={datos.diasPromedio} />}
      {datos.stockActual === 0 && <span style={{ fontSize: '11px', color: '#9ca3af' }}>Sin stock registrado</span>}

      <div style={{ marginTop: '6px' }}>
        <Link href={`/stocks/${cultivoKey}`} style={{ fontSize: '11px', color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
          Ver detalle del mes →
        </Link>
      </div>

      {datos.base && (
        <p style={{ margin: '6px 0 0', fontSize: '9px', color: '#9ca3af' }}>
          Base: {datos.base.tipo} del {String(datos.base.fecha).split('T')[0]} · {Number(datos.base.cantidad_paq).toLocaleString('es-AR')} paq.
        </p>
      )}

      {!mostrarForm && (
        <button type="button" className="btn" style={{ marginTop: '10px', width: '100%', fontSize: '12.5px', fontWeight: 700, padding: '7px 12px' }}
          onClick={() => setMostrarForm(true)}>
          📦 {datos.base ? 'Registrar ajuste' : 'Cargar stock inicial'}
        </button>
      )}

      {mostrarForm && (
        <form onSubmit={guardar} style={{ marginTop: '12px', borderTop: '1px solid #f3f4f6', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {error && <p style={{ color: '#dc2626', fontSize: '12px', margin: 0 }}>{error}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '11px' }}>Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value as any)} disabled={loading}>
                <option value="ajuste">Ajuste real</option>
                <option value="inicial">Stock inicial</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px' }}>Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} disabled={loading} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: '11px' }}>Cantidad (paquetes)</label>
            <input type="number" value={cantidad} onChange={e => setCantidad(e.target.value)} required min="0" step="any" disabled={loading} />
          </div>
          {tipo === 'ajuste' && (
            <div>
              <label style={{ fontSize: '11px' }} title="Cuánto de la diferencia es producto que se tira (podrido, pasado) — queda registrado como descarte en cámara">Descarte en cámara (paq, opcional)</label>
              <input type="number" value={descarte} onChange={e => setDescarte(e.target.value)} min="0" step="any" disabled={loading} placeholder="0" />
            </div>
          )}
          <div>
            <label style={{ fontSize: '11px' }}>Notas</label>
            <input type="text" value={notas} onChange={e => setNotas(e.target.value)} disabled={loading} placeholder="Opcional" />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="btn" style={{ fontSize: '11px', padding: '5px 12px' }} disabled={loading}>
              {loading ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="btn secondary" style={{ fontSize: '11px', padding: '5px 12px' }}
              onClick={() => setMostrarForm(false)} disabled={loading}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function StockCamaraCards({ rucula, lechugaCrespa, lechugaRoble, albahaca, valorizacionActual }: Props) {
  const router = useRouter();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
      <CardCamara datos={rucula} cultivo="Rúcula" cultivoKey="rucula" onSaved={() => router.refresh()} />
      <CardCamara datos={lechugaCrespa} cultivo="Lechuga Crespa" cultivoKey="lechuga_crespa" onSaved={() => router.refresh()} />
      <CardCamara datos={lechugaRoble} cultivo="Lechuga Hoja de Roble" cultivoKey="lechuga_roble" onSaved={() => router.refresh()} />
      <CardCamara datos={albahaca} cultivo="Albahaca" cultivoKey="albahaca" onSaved={() => router.refresh()} />
      <div style={{ background: '#111827', borderRadius: '10px', padding: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, color: '#d1d5db', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Stock valorizado</span>
          <span style={{ fontSize: '9px', color: '#9ca3af' }}>mes actual</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '4px' }}>
          <span style={{ fontSize: '26px', fontWeight: 800, color: 'white', lineHeight: 1 }}>${valorizacionActual.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
        </div>
        <Link href="/stocks#resumen-mes" style={{ fontSize: '11px', color: '#93c5fd', textDecoration: 'none', fontWeight: 600 }}>
          Ver por categoría/artículo →
        </Link>
      </div>
    </div>
  );
}
