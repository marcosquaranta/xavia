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
  const [plantasPorPaqueteManual, setPlantasPorPaqueteManual] = useState(3); // editable, default 3 — solo para estimar CANTIDAD de paquetes, no interviene en el peso
  const [pesoPaqGr, setPesoPaqGr] = useState(0); // peso del paquete pesado DIRECTAMENTE en la balanza — nunca se multiplica
  const [bandejas, setBandejas] = useState(0);
  const [tubosBandejas, setTubosBandejas] = useState(0);
  const [pesoBandGr, setPesoBandGr] = useState(0);
  const [parcial, setParcial] = useState(false);
  const [plantasQuedan, setPlantasQuedan] = useState(0);

  const plantasEst = Number(lote.plantas_estimadas_actual) || Number(lote.plantines_iniciales) || 0;
  const descarteAuto = useMemo(() => !esPorPaquete ? Math.max(0, plantasEst - plantas) : 0, [esPorPaquete, plantasEst, plantas]);
  const esRucula = lote.variedad.toLowerCase().includes('rucula') || lote.variedad.toLowerCase().includes('rúcula');

  // Para rúcula: paquetes estimados = plantas / plantasPorPaqueteManual
  const paquetesEstimados = esRucula && plantasEst > 0 ? Math.round(plantasEst / plantasPorPaqueteManual) : 0;
  // Plantas/paquete calculado desde paquetes reales ingresados
  const plantasPorPaqReal = useMemo(() => esPorPaquete && paquetes > 0 ? Math.round((plantasEst / paquetes) * 10) / 10 : 0, [esPorPaquete, plantasEst, paquetes]);

  // Alertas de calidad — mismo umbral que el Panel ("Desvíos y calidad de cosecha"):
  // lechuga con descarte > 5% de la cosecha del lote, o rúcula armada a más de 3
  // plantas por paquete.
  const descartePct = plantasEst > 0 ? Math.round((descarteAuto / plantasEst) * 1000) / 10 : 0;
  const descarteAlto = !esPorPaquete && plantasEst > 0 && descarteAuto / plantasEst > 0.05;
  const densidadAlta = esPorPaquete && esRucula && plantasPorPaqReal > 3;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    if (!esPorPaquete && plantas <= 0) { setError('Ingresá la cantidad de plantas cosechadas'); setLoading(false); return; }
    if (!esPorPaquete && pesoGr <= 0) { setError('Ingresá el pesaje testigo (peso del paquete en gramos)'); setLoading(false); return; }
    if (esPorPaquete && paquetes <= 0) { setError('Ingresá la cantidad de paquetes armados'); setLoading(false); return; }
    if (esPorPaquete && pesoPaqGr <= 0) { setError('Ingresá el pesaje testigo (peso del paquete en gramos)'); setLoading(false); return; }
    if (parcial && (plantasQuedan <= 0 || plantasQuedan >= plantasEst)) { setError(`En cosecha parcial, las plantas que quedan deben ser entre 1 y ${plantasEst - 1}`); setLoading(false); return; }
    if (descarteAlto && !window.confirm(`Descarte alto: ${descarteAuto} plantas, ${descartePct}% de la cosecha (más de 5%). ¿Confirmás registrar la cosecha igual?`)) { setLoading(false); return; }
    if (densidadAlta && !window.confirm(`Rúcula armada a ${plantasPorPaqReal} plantas/paquete (más de 3, paquetes más chicos de lo normal). ¿Confirmás registrar la cosecha igual?`)) { setLoading(false); return; }
    try {
      const res = await fetch('/api/lotes/cosecha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_lote: lote.id_lote, fecha, es_por_paquete: esPorPaquete,
          plantas_cosechadas: plantas, descarte: descarteAuto,
          peso_muestra_gr: pesoGr, paquetes_armados: paquetes,
          plantas_por_paquete: esPorPaquete ? plantasPorPaqueteManual : 1,
          peso_muestra_paquete_gr: pesoPaqGr, bandejas_armadas: bandejas,
          tubos_consumidos_bandejas: tubosBandejas, peso_muestra_bandeja_gr: pesoBandGr,
          plantas_estimadas_lote: plantasEst, usuario,
          parcial, plantas_quedan: parcial ? plantasQuedan : 0,
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      router.push('/cultivos'); router.refresh();
    } catch (err: any) { setError(err.message || 'Error'); setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}
      <div style={{ marginBottom: '14px' }}>
        <label>Fecha de cosecha *</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={loading} style={{ maxWidth: '220px' }} />
      </div>

      {/* Cosecha parcial */}
      <div style={{ background: parcial ? '#eff6ff' : '#f9fafb', border: `1px solid ${parcial ? '#93c5fd' : '#e5e7eb'}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: parcial ? '#1e40af' : '#374151' }}>
          <input type="checkbox" checked={parcial} onChange={e => setParcial(e.target.checked)} disabled={loading} style={{ width: '17px', height: '17px' }} />
          Cosecha parcial — queda una parte en la mesada
        </label>
        {parcial && (
          <div style={{ marginTop: '10px' }}>
            <label style={{ fontSize: '12px' }}>Plantas que <strong>quedan</strong> en la mesada (de ~{plantasEst})</label>
            <NumberInput value={plantasQuedan} onChange={setPlantasQuedan} min={0} disabled={loading} placeholder="Ej: 300" />
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#6b7280' }}>
              Se cosecha ~{Math.max(0, plantasEst - plantasQuedan)} plantas ahora. El lote sigue activo con {plantasQuedan || 0} plantas para cosechar después.
            </p>
          </div>
        )}
      </div>

      {!esPorPaquete && (
        <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: '14px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: '#4d7c0f' }}>Cosecha por planta</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <div><label>Plantas cosechadas *</label><NumberInput value={plantas} onChange={setPlantas} min={0} required disabled={loading} /></div>
            <div><label style={{ color: '#dc2626' }}>Pesaje testigo — peso del paquete en gramos *</label><NumberInput value={pesoGr} onChange={setPesoGr} min={0} required disabled={loading} placeholder="Ej: 82" /></div>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#6b7280' }}>En lechuga, el paquete es 1 planta — pesá el paquete directamente, no se multiplica por nada.</p>
          {plantas > 0 && (
            <div style={{ marginTop: '12px', padding: '10px 12px', background: '#f9fafb', borderRadius: '6px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Plantas estimadas</span><span>{plantasEst}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Plantas cosechadas</span><span>{plantas}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, paddingTop: '6px', borderTop: '1px solid #e5e7eb', marginTop: '6px', color: descarteAuto > 0 ? '#dc2626' : '#059669' }}>
                <span>Descarte automático</span><span>{descarteAuto}</span>
              </div>
            </div>
          )}
          {descarteAlto && (
            <div style={{ marginTop: '10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', color: '#7f1d1d', fontWeight: 600 }}>
              ⚠️ Descarte alto: {descarteAuto} plantas, {descartePct}% de la cosecha (más de 5%) — va a quedar marcado en Alertas del panel.
            </div>
          )}
        </div>
      )}

      {esPorPaquete && (
        <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: '14px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: '#166534' }}>Destino paquetes</p>

          {/* Plantas/paquete editable — default 3 */}
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 600, color: '#166534' }}>Plantas por paquete</p>
                <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>
                  Lote: ~{plantasEst.toLocaleString('es-AR')} plantas
                  {paquetesEstimados > 0 && <span style={{ color: '#166534', fontWeight: 600 }}> → ~{paquetesEstimados.toLocaleString('es-AR')} paquetes estimados</span>}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>plantas/paq:</label>
                <div style={{ width: '80px' }}>
                  <NumberInput value={plantasPorPaqueteManual} onChange={setPlantasPorPaqueteManual} min={1} disabled={loading} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <div><label>Paquetes armados (real) *</label><NumberInput value={paquetes} onChange={setPaquetes} min={0} required disabled={loading} /></div>
            <div>
              <label style={{ color: '#dc2626' }}>Pesaje testigo — peso del paquete en gramos *</label>
              <NumberInput value={pesoPaqGr} onChange={setPesoPaqGr} min={0} required disabled={loading} placeholder="Ej: 210" />
            </div>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#6b7280' }}>Pesá el paquete armado directamente en la balanza — es el peso final, no se multiplica por la cantidad de plantas por paquete.</p>

          {paquetes > 0 && (
            <div style={{ marginTop: '12px', padding: '10px 12px', background: '#f0fdf4', borderRadius: '6px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Plantas del lote</span><span>{plantasEst.toLocaleString('es-AR')}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Paquetes armados</span><span>{paquetes}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, paddingTop: '6px', borderTop: '1px solid #e5e7eb', marginTop: '6px', color: '#166534' }}>
                <span>Plantas/paquete configurado</span>
                <span>{plantasPorPaqueteManual} {plantasPorPaqReal !== plantasPorPaqueteManual && <span style={{ color: '#9ca3af' }}>(real: {plantasPorPaqReal})</span>}</span>
              </div>
            </div>
          )}
          {densidadAlta && (
            <div style={{ marginTop: '10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', color: '#78350f', fontWeight: 600 }}>
              ⚠️ {plantasPorPaqReal} plantas por paquete (más de 3) — paquetes más chicos de lo normal, va a quedar marcado en Alertas del panel.
            </div>
          )}

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
