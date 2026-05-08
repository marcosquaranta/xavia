'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Ubicacion } from '@/lib/types';
import NumberInput from '@/components/NumberInput';
export default function EditarLoteForm({ lote, ubicaciones }: { lote: Lote; ubicaciones: Ubicacion[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [fase, setFase] = useState(String(lote.fase_actual || 'plantin'));
  const [estado, setEstado] = useState(String(lote.estado || 'activo'));
  const [ubic, setUbic] = useState(String(lote.ubicacion_actual || ''));
  const [plantas, setPlantas] = useState(Number(lote.plantas_estimadas_actual) || 0);
  const [tubos, setTubos] = useState(Number(lote.tubos_ocupados_actual) || 0);
  const [notas, setNotas] = useState(String(lote.notas || ''));
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null); setMensaje(null);
    try {
      const res = await fetch('/api/lotes/editar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_lote: lote.id_lote, fase_actual: fase, estado, ubicacion_actual: ubic, plantas_estimadas_actual: plantas, tubos_ocupados_actual: tubos, notas }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      setMensaje('Cambios guardados correctamente'); router.refresh();
    } catch (err: any) { setError(err.message || 'Error'); } finally { setLoading(false); }
  }
  return (
    <form onSubmit={handleSubmit} className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}
      {mensaje && <div className="alert-box success" style={{ marginBottom: '14px' }}>{mensaje}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div><label>Fase actual</label><select value={fase} onChange={(e) => setFase(e.target.value)} disabled={loading}><option value="plantin">Plantinera</option><option value="fase_1">Fase 1</option><option value="fase_2">Fase 2</option></select></div>
        <div><label>Estado</label><select value={estado} onChange={(e) => setEstado(e.target.value)} disabled={loading}><option value="activo">Activo</option><option value="cosechado">Cosechado</option><option value="descartado">Descartado</option></select></div>
        <div><label>Ubicación actual</label><select value={ubic} onChange={(e) => setUbic(e.target.value)} disabled={loading}><option value="">— Sin asignar —</option>{ubicaciones.map((u) => <option key={u.id_ubicacion} value={u.nombre}>{u.nombre}</option>)}</select></div>
        <div><label>Plantas estimadas actuales</label><NumberInput value={plantas} onChange={setPlantas} min={0} disabled={loading} /></div>
        <div><label>Tubos ocupados</label><NumberInput value={tubos} onChange={setTubos} min={0} disabled={loading} /></div>
      </div>
      <div style={{ marginTop: '14px' }}><label>Notas</label><textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} disabled={loading} style={{ resize: 'vertical' }} /></div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button type="submit" className="btn" disabled={loading}>{loading ? 'Guardando…' : 'Guardar cambios'}</button>
        <button type="button" className="btn secondary" onClick={() => router.push('/cultivos/' + encodeURIComponent(lote.id_lote))} disabled={loading}>Cancelar</button>
      </div>
    </form>
  );
}