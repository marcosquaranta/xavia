'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Variedad, Semilla } from '@/lib/types';
import NumberInput from '@/components/NumberInput';

const HOY = new Date().toISOString().split('T')[0];
const PLANTINES_POR_PLANCHA = 345;

export default function NuevoLoteForm({
  variedades, semillas, usuario,
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
  const [fecha, setFecha] = useState(HOY);
  const [notas, setNotas] = useState('');
  const [planchas, setPlanchas] = useState(0);
  const [plantines, setPlantines] = useState(0);

  const semFiltradas = semillas.filter((s) => s.variedad === variedad);

  function handlePlanchas(val: number) {
    setPlanchas(val);
    setPlantines(val * PLANTINES_POR_PLANCHA);
  }

  function handlePlantines(val: number) {
    setPlantines(val);
    // Si se edita plantines directamente, limpiar planchas para no confundir
    setPlanchas(0);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    if (plantines <= 0) {
      setError('Ingresá la cantidad de planchas o de plantines sembrados');
      setLoading(false); return;
    }
    try {
      const res = await fetch('/api/lotes/nuevo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nave: Number(nave),
          variedad,
          semilla_id: semillaId,
          plantines_iniciales: plantines,
          fecha_siembra: fecha,
          notas,
          usuario,
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      router.push('/cultivos'); router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div>
          <label>Plantinera *</label>
          <select value={nave} onChange={(e) => setNave(e.target.value as '1' | '2')} required disabled={loading}>
            <option value="1">Nave 1 - Plantinera</option>
            <option value="2">Nave 2 - Plantinera</option>
          </select>
        </div>
        <div>
          <label>Variedad *</label>
          <select value={variedad} onChange={(e) => { setVariedad(e.target.value); setSemillaId(''); }} required disabled={loading}>
            {variedades.map((v) => <option key={v.variedad} value={v.variedad}>{v.variedad}</option>)}
          </select>
        </div>
        <div>
          <label>Semilla / batch</label>
          <select value={semillaId} onChange={(e) => setSemillaId(e.target.value)} disabled={loading}>
            <option value="">— Sin especificar —</option>
            {semFiltradas.map((s) => <option key={s.id_semilla} value={s.id_semilla}>{s.proveedor} · {s.batch}</option>)}
          </select>
        </div>
        <div>
          <label>Fecha de siembra *</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={loading} />
        </div>
      </div>

      {/* Calculadora de plantines */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', marginTop: '16px' }}>
        <p style={{ margin: '0 0 14px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
          Cantidad sembrada
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '12px', alignItems: 'end' }}>
          <div>
            <label>
              Planchas sembradas
              <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}> (× {PLANTINES_POR_PLANCHA})</span>
            </label>
            <NumberInput value={planchas} onChange={handlePlanchas} min={0} disabled={loading} />
          </div>
          <div style={{ textAlign: 'center', paddingBottom: '10px', color: '#9ca3af', fontSize: '18px' }}>→</div>
          <div>
            <label>
              Plantines totales
              <span style={{ color: '#059669', fontWeight: 400, textTransform: 'none' }}> — editable</span>
            </label>
            <NumberInput value={plantines} onChange={handlePlantines} min={0} required disabled={loading} />
          </div>
        </div>
        {planchas > 0 && plantines > 0 && (
          <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#6b7280' }}>
            {planchas} plancha{planchas > 1 ? 's' : ''} × {PLANTINES_POR_PLANCHA} = <strong>{planchas * PLANTINES_POR_PLANCHA}</strong> plantines
            {plantines !== planchas * PLANTINES_POR_PLANCHA && (
              <span style={{ color: '#d97706' }}> · ajustado a {plantines}</span>
            )}
          </p>
        )}
      </div>

      <div style={{ marginTop: '14px' }}>
        <label>Notas (opcional)</label>
        <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} disabled={loading} placeholder="Observaciones del lote" style={{ resize: 'vertical' }} />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Guardando…' : 'Registrar lote'}
        </button>
        <button type="button" className="btn secondary" onClick={() => router.push('/cultivos')} disabled={loading}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
