'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Ubicacion } from '@/lib/types';
import NumberInput from '@/components/NumberInput';
const HOY = new Date().toISOString().split('T')[0];
export default function TrasplanteForm({ lote, faseDestino, ubicacionesDestino, usuario }: { lote: Lote; faseDestino: 'fase_1' | 'fase_2'; ubicacionesDestino: Ubicacion[]; usuario: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState(HOY);
  const [ubicId, setUbicId] = useState(ubicacionesDestino[0]?.id_ubicacion || '');
  const [tubos, setTubos] = useState(0);
  const [descarte, setDescarte] = useState(0);
  const [destinoRestante, setDestinoRestante] = useState<'queda' | 'descartar'>('queda');
  const ubic = ubicacionesDestino.find((u) => u.id_ubicacion === ubicId);
  const cantidadActual = useMemo(() => { const est = Number(lote.plantas_estimadas_actual); if (est && est > 0) return est; return Number(lote.plantines_iniciales) || 0; }, [lote]);
  const plantasTrasplantadas = useMemo(() => { if (!ubic) return 0; return tubos * Number(ubic.orificios_por_perfil || 0); }, [tubos, ubic]);
  const restante = Math.max(0, cantidadActual - plantasTrasplantadas - descarte);
  const plantasQueQuedan = destinoRestante === 'queda' ? restante : 0;
  const descarteFinal = destinoRestante === 'descartar' ? descarte + restante : descarte;
  const hayRestante = restante > 0 && plantasTrasplantadas > 0;
  const seDivide = plantasQueQuedan > 0 && plantasTrasplantadas > 0;
  const labelOrigen = lote.fase_actual === 'plantin' ? 'plantines' : lote.fase_actual === 'fase_1' ? 'plantas en F1' : 'plantas';
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    if (!ubic) { setError('Seleccioná una ubicación destino'); setLoading(false); return; }
    if (plantasTrasplantadas <= 0) { setError('Tenés que trasplantar al menos un tubo'); setLoading(false); return; }
    if (plantasTrasplantadas + descarte > cantidadActual) { setError('No podés trasplantar + descartar más de ' + cantidadActual + ' ' + labelOrigen); setLoading(false); return; }
    try {
      const res = await fetch('/api/lotes/trasplante', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_lote: lote.id_lote, fecha, ubicacion_destino_id: ubicId, tubos_ocupados: tubos, plantas_trasplantadas: plantasTrasplantadas, plantas_quedan: plantasQueQuedan, descarte: descarteFinal, fase_destino: faseDestino, usuario }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      router.push('/cultivos'); router.refresh();
    } catch (err: any) { setError(err.message || 'Error'); setLoading(false); }
  }
  return (
    <form onSubmit={handleSubmit} className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div><label>Fecha *</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={loading} /></div>
        <div><label>Mesada destino *</label><select value={ubicId} onChange={(e) => setUbicId(e.target.value)} required disabled={loading}>{ubicacionesDestino.map((u) => <option key={u.id_ubicacion} value={u.id_ubicacion}>{u.nombre}</option>)}</select></div>
        <div><label>Tubos ocupados en destino *{ubic && <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}> ({ubic.orificios_por_perfil} orif/tubo)</span>}</label><NumberInput value={tubos} onChange={setTubos} min={0} required disabled={loading} /></div>
        <div><label>Descarte al trasplantar</label><NumberInput value={descarte} onChange={setDescarte} min={0} disabled={loading} /></div>
      </div>
      <div style={{ marginTop: '14px', padding: '12px 14px', background: '#f9fafb', borderRadius: '6px', fontSize: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Cantidad actual</span><span>{cantidadActual} {labelOrigen}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Se trasplantan</span><span>{plantasTrasplantadas}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Descarte</span><span>{descarte}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid #e5e7eb', marginTop: '6px', fontWeight: 500 }}><span>Restante calculado</span><span>{restante}</span></div>
      </div>
      {hayRestante && (
        <div style={{ marginTop: '14px', padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
          <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: '13px', color: '#78350f' }}>¿Qué hacemos con las {restante} {labelOrigen} restantes?</p>
          <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
            {[['queda', 'Quedan en ' + (lote.fase_actual === 'plantin' ? 'plantinera' : 'F1') + ' (el lote actual sigue con ' + restante + ' ' + labelOrigen + ')'], ['descartar', 'Descarte / desperdicio (el lote actual se cierra con 0)']].map(([val, label]: any) => (
              <label key={val} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '8px 12px', background: destinoRestante === val ? (val === 'queda' ? '#fef3c7' : '#fee2e2') : 'transparent', borderRadius: '6px', fontSize: '13px', textTransform: 'none', letterSpacing: 'normal', margin: 0, color: '#1f2937' }}>
                <input type="radio" name="destRest" value={val} checked={destinoRestante === val} onChange={() => setDestinoRestante(val as 'queda' | 'descartar')} disabled={loading} style={{ width: 'auto' }} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {seDivide && destinoRestante === 'queda' && <div className="alert-box info" style={{ marginTop: '14px' }}><strong>El lote se va a dividir.</strong><br/>Se trasplantan <strong>{plantasTrasplantadas}</strong> → lote nuevo. Quedan <strong>{plantasQueQuedan}</strong> en el lote original.</div>}
      {hayRestante && destinoRestante === 'descartar' && <div className="alert-box warning" style={{ marginTop: '14px' }}>Las <strong>{restante}</strong> restantes van a descarte. Se trasplantan <strong>{plantasTrasplantadas}</strong>. El lote original se cierra.</div>}
      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button type="submit" className="btn" disabled={loading}>{loading ? 'Guardando…' : 'Confirmar trasplante'}</button>
        <button type="button" className="btn secondary" onClick={() => router.push('/cultivos')} disabled={loading}>Cancelar</button>
      </div>
    </form>
  );
}