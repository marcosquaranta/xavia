'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Variedad, Semilla } from '@/lib/types';
import NumberInput from '@/components/NumberInput';
const HOY = new Date().toISOString().split('T')[0];
export default function NuevoLoteForm({ variedades, semillas, usuario }: { variedades: Variedad[]; semillas: Semilla[]; usuario: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nave, setNave] = useState<'1' | '2'>('1');
  const [variedad, setVariedad] = useState(variedades[0]?.variedad || '');
  const [semillaId, setSemillaId] = useState('');
  const [plantines, setPlantines] = useState(0);
  const [fecha, setFecha] = useState(HOY);
  const [notas, setNotas] = useState('');
  const semFiltradas = semillas.filter((s) => s.variedad === variedad);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const res = await fetch('/api/lotes/nuevo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nave: Number(nave), variedad, semilla_id: semillaId, plantines_iniciales: plantines, fecha_siembra: fecha, notas, usuario }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      const j = await res.json();
      router.push('/cultivos'); router.refresh();
    } catch (err: any) { setError(err.message || 'Error'); setLoading(false); }
  }
  return (
    <form onSubmit={handleSubmit} className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div><label>Plantinera *</label><select value={nave} onChange={(e) => setNave(e.target.value as '1' | '2')} required disabled={loading}><option value="1">Nave 1 - Plantinera</option><option value="2">Nave 2 - Plantinera</option></select></div>
        <div><label>Variedad *</label><select value={variedad} onChange={(e) => { setVariedad(e.target.value); setSemillaId(''); }} required disabled={loading}>{variedades.map((v) => <option key={v.variedad} value={v.variedad}>{v.variedad}</option>)}</select></div>
        <div><label>Semilla / batch</label><select value={semillaId} onChange={(e) => setSemillaId(e.target.value)} disabled={loading}><option value="">— Sin especificar —</option>{semFiltradas.map((s) => <option key={s.id_semilla} value={s.id_semilla}>{s.proveedor} · {s.batch}</option>)}</select></div>
        <div><label>Plantines sembrados *</label><NumberInput value={plantines} onChange={setPlantines} min={1} required disabled={loading} /></div>
        <div><label>Fecha de siembra *</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={loading} /></div>
      </div>
      <div style={{ marginTop: '14px' }}><label>Notas (opcional)</label><textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} disabled={loading} placeholder="Observaciones del lote" style={{ resize: 'vertical' }} /></div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button type="submit" className="btn" disabled={loading}>{loading ? 'Guardando…' : 'Registrar lote'}</button>
        <button type="button" className="btn secondary" onClick={() => router.push('/cultivos')} disabled={loading}>Cancelar</button>
      </div>
    </form>
  );
}