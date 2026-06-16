'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Variedad } from '@/lib/types';
import NumberInput from '@/components/NumberInput';
const HOY = new Date().toISOString().split('T')[0];

type Modo = 'paquete' | 'cajon' | 'planta';

export default function CosechaForm({ lote, variedad, esPorPaquete, usuario }: { lote: Lote; variedad: Variedad; esPorPaquete: boolean; usuario: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState(HOY);
  // Modo
  const defaultModo: Modo = esPorPaquete ? 'paquete' : 'planta';
  const [modo, setModo] = useState<Modo>(defaultModo);
  // Planta
  const [plantas, setPlantas] = useState(0);
  const [pesoGr, setPesoGr] = useState(0);
  // Paquete
  const [paquetes, setPaquetes] = useState(0);
  const [pesoPaqGr, setPesoPaqGr] = useState(0);
  const [bandejas, setBandejas] = useState(0);
  const [tubosBandejas, setTubosBandejas] = useState(0);
  const [pesoBandGr, setPesoBandGr] = useState(0);
  // Cajón
  const [cajones, setCajones] = useState(0);
  const [kgPorCajon, setKgPorCajon] = useState(0);

  const plantasEst = Number(lote.plantas_estimadas_actual) || Number(lote.plantines_iniciales) || 0;
  const descarteAuto = useMemo(() => modo === 'planta' ? Math.max(0, plantasEst - plantas) : 0, [modo, plantasEst, plantas]);
  const plantasPorPaq = useMemo(() => modo === 'paquete' && paquetes > 0 ? Math.round((plantasEst / paquetes) * 10) / 10 : 0, [modo, plantasEst, paquetes]);
  const esRucula = lote.variedad.toLowerCase().includes('rucula') || lote.variedad.toLowerCase().includes('rúcula');
  const totalKgCajon = cajones > 0 && kgPorCajon > 0 ? (cajones * kgPorCajon) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    if (modo === 'planta' && plantas <= 0) { setError('Ingresá la cantidad de plantas cosechadas'); setLoading(false); return; }
    if (modo === 'paquete' && paquetes <= 0) { setError('Ingresá la cantidad de paquetes armados'); setLoading(false); return; }
    if (modo === 'paquete' && pesoPaqGr <= 0) { setError('El pesaje testigo del paquete es obligatorio'); setLoading(false); return; }
    if (modo === 'cajon' && cajones <= 0) { setError('Ingresá la cantidad de cajones'); setLoading(false); return; }
    if (modo === 'cajon' && kgPorCajon <= 0) { setError('Ingresá el peso por cajón (KG)'); setLoading(false); return; }
    try {
      const res = await fetch('/api/lotes/cosecha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_lote: lote.id_lote, fecha, modo,
          // planta
          plantas_cosechadas: plantas, descarte: descarteAuto, peso_muestra_gr: pesoGr,
          // paquete
          paquetes_armados: paquetes, plantas_por_paquete: plantasPorPaq, peso_muestra_paquete_gr: pesoPaqGr,
          bandejas_armadas: bandejas, tubos_consumidos_bandejas: tubosBandejas, peso_muestra_bandeja_gr: pesoBandGr,
          // cajón
          cajones_armados: cajones, kg_por_cajon: kgPorCajon, peso_total_kg_cajon: totalKgCajon,
          // común
          plantas_estimadas_lote: plantasEst, usuario,
          // retrocompat
          es_por_paquete: modo === 'paquete',
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      router.push('/cultivos'); router.refresh();
    } catch (err: any) { setError(err.message || 'Error'); setLoading(false); }
  }

  const modoBtn = (m: Modo, label: string) => (
    <button type="button" onClick={() => setModo(m)} style={{
      padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: modo === m ? 700 : 500, cursor: 'pointer',
      border: modo === m ? '2px solid #166534' : '1px solid #d1d5db',
      background: modo === m ? '#dcfce7' : 'white', color: modo === m ? '#166534' : '#374151',
    }}>{label}</button>
  );

  return (
    <form onSubmit={handleSubmit} className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}
      <div style={{ marginBottom: '14px' }}>
        <label>Fecha de cosecha *</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={loading} style={{ maxWidth: '220px' }} />
      </div>

      {/* Selector de modo */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>Tipo de cosecha *</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {esPorPaquete && modoBtn('paquete', '📦 Paquetes')}
          {!esPorPaquete && modoBtn('planta', '🌿 Plantas')}
          {modoBtn('cajon', '📫 Cajones (KG)')}
        </div>
      </div>

      {/* Modo planta */}
      {modo === 'planta' && (
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

      {/* Modo paquete */}
      {modo === 'paquete' && (
        <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: '14px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: '#166534' }}>Destino paquetes</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <div><label>Paquetes armados *</label><NumberInput value={paquetes} onChange={setPaquetes} min={0} required disabled={loading} /></div>
            <div>
              <label style={{ color: '#dc2626' }}>Pesaje testigo — gramos/paquete *</label>
              <NumberInput value={pesoPaqGr} onChange={setPesoPaqGr} min={0} required disabled={loading} placeholder="Ej: 330" />
              <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#9ca3af' }}>Peso de UN paquete representativo</p>
            </div>
          </div>
          {paquetes > 0 && <div style={{ marginTop: '12px', padding: '10px 12px', background: '#f0fdf4', borderRadius: '6px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Plantas del lote</span><span>{plantasEst}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Paquetes armados</span><span>{paquetes}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, paddingTop: '6px', borderTop: '1px solid #e5e7eb', marginTop: '6px', color: '#166534' }}><span>Plantas/paquete (calculado)</span><span>{plantasPorPaq}</span></div>
            {pesoPaqGr > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280', paddingTop: '4px' }}><span>Peso total estimado</span><span>{((pesoPaqGr * paquetes) / 1000).toFixed(1)} kg</span></div>}
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

      {/* Modo cajón */}
      {modo === 'cajon' && (
        <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: '14px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: '#92400e' }}>Cosecha por cajón · venta por KG</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <div><label>Cajones armados *</label><NumberInput value={cajones} onChange={setCajones} min={0} required disabled={loading} /></div>
            <div>
              <label>KG por cajón *</label>
              <NumberInput value={kgPorCajon} onChange={setKgPorCajon} min={0} required disabled={loading} placeholder="Ej: 4.5" />
            </div>
          </div>
          {cajones > 0 && kgPorCajon > 0 && (
            <div style={{ marginTop: '12px', padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Cajones</span><span>{cajones}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>KG por cajón</span><span>{kgPorCajon} kg</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, paddingTop: '6px', borderTop: '1px solid #fde68a', marginTop: '6px', color: '#92400e' }}><span>Total cosecha</span><span>{totalKgCajon.toFixed(1)} kg</span></div>
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
