'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Variedad } from '@/lib/types';
import NumberInput from '@/components/NumberInput';
const HOY = new Date().toISOString().split('T')[0];
export default function CosechaForm({ lote, variedad, esPorPaquete, usuario }: { lote: Lote; variedad: Variedad; esPorPaquete: boolean; usuario: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState(HOY);
  const [plantas, setPlantas] = useState(0);
  const [pesoGr, setPesoGr] = useState(0);
  const [paquetes, setPaquetes] = useState(0);
  const [pesoPaqGr, setPesoPaqGr] = useState(0);
  const [bandejas, setBandejas] = useState(0);
  const [tubosBandejas, setTubosBandejas] = useState(0);
  const [pesoBandGr, setPesoBandGr] = useState(0);
  const plantasEst = Number(lote.plantas_estimadas_actual) || Number(lote.plantines_iniciales) || 0;
  const descarteAuto = useMemo(() => !esPorPaquete ? Math.max(0, plantasEst - plantas) : 0, [esPorPaquete, plantasEst, plantas]);
  const plantasPorPaq = useMemo(() => esPorPaquete && paquetes > 0 ? Math.round((plantasEst / paquetes) * 10) / 10 : 0, [esPorPaquete, plantasEst, paquetes]);
  const esRucula = lote.variedad.toLowerCase().includes('rucula') || lote.variedad.toLowerCase().includes('rúcula');
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    if (!esPorPaquete && plantas <= 0) { setError('Ingresá la cantidad de plantas cosechadas'); setLoading(false); return; }
    if (esPorPaquete && paquetes <= 0) { setError('Ingresá la cantidad de paquetes armados'); setLoading(false); return; }
    try {
      const res = await fetch('/api/lotes/cosecha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_lote: lote.id_lote, fecha, es_por_paquete: esPorPaquete, plantas_cosechadas: plantas, descarte: descarteAuto, peso_muestra_gr: pesoGr, paquetes_armados: paquetes, plantas_por_paquete: plantasPorPaq, peso_muestra_paquete_gr: pesoPaqGr, bandejas_armadas: bandejas, tubos_consumidos_bandejas: tubosBandejas, peso_muestra_bandeja_gr: pesoBandGr, plantas_estimadas_lote: plantasEst, usuario }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      router.push('/cultivos'); router.refresh();
    } catch (err: any) { setError(err.message || 'Error'); setLoading(false); }
  }
  return (
    <form onSubmit={handleSubmit} className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}
      <div style={{ marginBottom: '14px' }}><label>Fecha de cosecha *</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={loading} style={{ maxWidth: '220px' }} /></div>
      {!esPorPaquete && (
        <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: '14px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: '#4d7c0f' }}>Cosecha por planta</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <div><label>Plantas cosechadas *</label><NumberInput value={plantas} onChange={setPlantas} min={0} required disabled={loading} /></div>
            <div><label>Peso de muestra (gramos) — opcional</label><NumberInput value={pesoGr} onChange={setPesoGr} min={0} disabled={loading} placeholder="Ej: 82" /></div>
          </div>
          {plantas > 0 && <div style={{ marginTop: '12px', padding: '10px 12px', background: '#f9fafb', borderRadius: '6px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Plantas estimadas</span><span>{plantasEst}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Plantas cosechadas</span><span>{plantas}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, paddingTop: '6px', borderTop: '1px solid #e5e7eb', marginTop: '6px', color: descarteAuto > 0 ? '#dc2626' : '#059669' }}><span>Descarte automático</span><span>{descarteAuto}</span></div>
          </div>}
        </div>
      )}
      {esPorPaquete && (
        <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: '14px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: '#166534' }}>Destino paquetes</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <div><label>Paquetes armados *</label><NumberInput value={paquetes} onChange={setPaquetes} min={0} required disabled={loading} /></div>
            <div><label>Peso muestra paquete (gramos) — opcional</label><NumberInput value={pesoPaqGr} onChange={setPesoPaqGr} min={0} disabled={loading} placeholder="Ej: 45" /></div>
          </div>
          {paquetes > 0 && <div style={{ marginTop: '12px', padding: '10px 12px', background: '#f0fdf4', borderRadius: '6px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Plantas del lote</span><span>{plantasEst}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Paquetes armados</span><span>{paquetes}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, paddingTop: '6px', borderTop: '1px solid #e5e7eb', marginTop: '6px', color: '#166534' }}><span>Plantas/paquete (calculado)</span><span>{plantasPorPaq}</span></div>
          </div>}
          {esRucula && (
            <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: '14px', marginTop: '14px' }}>
              <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600, color: '#166534' }}>Destino bandejas — opcional</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                <div><label>Bandejas armadas</label><NumberInput value={bandejas} onChange={setBandejas} min={0} disabled={loading} /></div>
                <div><label>Tubos consumidos</label><NumberInput value={tubosBandejas} onChange={setTubosBandejas} min={0} disabled={loading} /></div>
                <div><label>Peso muestra bandeja (gramos) — opcional</label><NumberInput value={pesoBandGr} onChange={setPesoBandGr} min={0} disabled={loading} placeholder="Ej: 120" /></div>
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
        <button type="submit" className="btn" disabled={loading}>{loading ? 'Guardando…' : 'Registrar cosecha'}</button>
        <button type="button" className="btn secondary" onClick={() => router.push('/cultivos')} disabled={loading}>Cancelar</button>
      </div>
    </form>
  );
}