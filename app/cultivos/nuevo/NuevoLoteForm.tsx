// app/cultivos/nuevo/NuevoLoteForm.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Variedad, Semilla } from '@/lib/types';

const HOY = new Date().toISOString().split('T')[0];

export default function NuevoLoteForm({
  variedades,
  semillas,
  usuario,
}: {
  variedades: Variedad[];
  semillas: Semilla[];
  usuario: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nave, setNave] = useState<'1' | '2'>('1');
  const [variedad, setVariedad] = useState(variedades[0]?.variedad || '');
  const [semillaId, setSemillaId] = useState('');
  const [plantinesIniciales, setPlantinesIniciales] = useState(150);
  const [fechaSiembra, setFechaSiembra] = useState(HOY);
  const [notas, setNotas] = useState('');

  const semillasFiltradas = semillas.filter((s) => s.variedad === variedad);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/lotes/nuevo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nave: Number(nave),
          variedad,
          semilla_id: semillaId,
          plantines_iniciales: plantinesIniciales,
          fecha_siembra: fechaSiembra,
          notas,
          usuario,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al guardar');
      }
      const json = await res.json();
      router.push(`/cultivos?nuevo=${encodeURIComponent(json.id_lote)}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      {error && (
        <div className="alert-box error" style={{ marginBottom: '14px' }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px',
        }}
      >
        <div>
          <label>Plantinera de origen *</label>
          <select
            value={nave}
            onChange={(e) => setNave(e.target.value as '1' | '2')}
            required
            disabled={loading}
          >
            <option value="1">Nave 1 - Plantinera</option>
            <option value="2">Nave 2 - Plantinera</option>
          </select>
        </div>

        <div>
          <label>Variedad *</label>
          <select
            value={variedad}
            onChange={(e) => {
              setVariedad(e.target.value);
              setSemillaId('');
            }}
            required
            disabled={loading}
          >
            {variedades.map((v) => (
              <option key={v.variedad} value={v.variedad}>
                {v.variedad}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Semilla / batch</label>
          <select
            value={semillaId}
            onChange={(e) => setSemillaId(e.target.value)}
            disabled={loading}
          >
            <option value="">— Sin especificar —</option>
            {semillasFiltradas.map((s) => (
              <option key={s.id_semilla} value={s.id_semilla}>
                {s.proveedor} · {s.batch}
              </option>
            ))}
          </select>
          {semillasFiltradas.length === 0 && (
            <p style={{ fontSize: '11px', color: '#9ca3af', margin: '4px 0 0' }}>
              No hay batches cargados de esta variedad. Podés agregarlos desde Admin →
              Semillas.
            </p>
          )}
        </div>

        <div>
          <label>Plantines sembrados *</label>
          <input
            type="number"
            value={plantinesIniciales}
            onChange={(e) => setPlantinesIniciales(Number(e.target.value))}
            min={1}
            required
            disabled={loading}
          />
        </div>

        <div>
          <label>Fecha de siembra *</label>
          <input
            type="date"
            value={fechaSiembra}
            onChange={(e) => setFechaSiembra(e.target.value)}
            required
            disabled={loading}
          />
        </div>
      </div>

      <div style={{ marginTop: '14px' }}>
        <label>Notas (opcional)</label>
        <textarea
          rows={2}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          disabled={loading}
          placeholder="Observaciones del lote"
          style={{ resize: 'vertical' }}
        />
      </div>

      <div className="alert-box info" style={{ marginTop: '14px' }}>
        <strong>Cómo se asigna el ID:</strong> al guardar, este lote recibe un ID
        provisional como <code>N1-007</code> (Nave + correlativo). Cuando lo trasplantes
        a una mesada se completa con cultivo y mesada (ej: <code>N1L1-007</code>).
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Guardando…' : 'Registrar lote'}
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => router.push('/cultivos')}
          disabled={loading}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
