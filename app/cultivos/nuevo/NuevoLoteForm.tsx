'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Variedad, Semilla } from '@/lib/types';
import NumberInput from '@/components/NumberInput';

const HOY = new Date().toISOString().split('T')[0];

function esRucula(variedad: string): boolean {
  const v = variedad.toLowerCase();
  return v.includes('rucula') || v.includes('rúcula');
}

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
  const [posiciones, setPosiciones] = useState(0);
  const [fecha, setFecha] = useState(HOY);
  const [notas, setNotas] = useState('');

  const semFiltradas = semillas.filter((s) => s.variedad === variedad);
  const esRuc = esRucula(variedad);
  const factorPlantines = esRuc ? 2 : 1;

  // Plantines calculados automáticamente
  const plantinesCalculados = posiciones * factorPlantines;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    if (posiciones <= 0) {
      setError('Ingresá la cantidad de posiciones/huecos sembrados');
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
          plantines_iniciales: plantinesCalculados,
          posiciones_sembradas: posiciones,
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
          <label>
            Posiciones / huecos sembrados *
            <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none', letterSpacing: 'normal' }}>
              {' '}({esRuc ? '2 plantines/posición' : '1 planta/posición'})
            </span>
          </label>
          <NumberInput value={posiciones} onChange={setPosiciones} min={1} required disabled={loading} />
        </div>

        <div>
          <label>Fecha de siembra *</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={loading} />
        </div>
      </div>

      {/* Resumen del cálculo */}
      {posiciones > 0 && (
        <div style={{
          marginTop: '14px', padding: '12px 14px',
          background: esRuc ? '#dcfce7' : '#f7fee7',
          borderRadius: '6px', fontSize: '12px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#6b7280' }}>Posiciones sembradas</span>
            <span>{posiciones}</span>
          </div>
          {esRuc && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Factor rúcula (× 2)</span>
              <span>× 2</span>
            </div>
          )}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontWeight: 600, paddingTop: '6px',
            borderTop: '1px solid #e5e7eb', marginTop: '6px',
          }}>
            <span>Plantines totales a registrar</span>
            <span>{plantinesCalculados.toLocaleString('es-AR')}</span>
          </div>
        </div>
      )}

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
