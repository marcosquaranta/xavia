// app/cultivos/[id]/cosechar/CosechaForm.tsx
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Variedad } from '@/lib/types';
import NumberInput from '@/components/NumberInput';

const HOY = new Date().toISOString().split('T')[0];

export default function CosechaForm({
  lote,
  variedad,
  esPorPaquete,
  usuario,
}: {
  lote: Lote;
  variedad: Variedad;
  esPorPaquete: boolean;
  usuario: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fecha, setFecha] = useState(HOY);

  // Lechuga: por planta
  const [plantasCosechadas, setPlantasCosechadas] = useState(0);
  const [pesoMuestraGr, setPesoMuestraGr] = useState(0); // en gramos, opcional

  // Rúcula/Albahaca: por paquete
  const [paquetesArmados, setPaquetesArmados] = useState(0);
  const [pesoMuestraPaqueteGr, setPesoMuestraPaqueteGr] = useState(0);

  // Bandejas (solo rúcula, opcional)
  const [bandejasArmadas, setBandejasArmadas] = useState(0);
  const [tubosConsumidosBandejas, setTubosConsumidosBandejas] = useState(0);
  const [pesoMuestraBandejaGr, setPesoMuestraBandejaGr] = useState(0);

  const plantasEstimadas = Number(lote.plantas_estimadas_actual) || Number(lote.plantines_iniciales) || 0;

  // Para lechuga: descarte = estimadas - cosechadas (automático)
  const descarteAuto = useMemo(() => {
    if (!esPorPaquete) {
      return Math.max(0, plantasEstimadas - plantasCosechadas);
    }
    return 0; // rúcula no tiene descarte
  }, [esPorPaquete, plantasEstimadas, plantasCosechadas]);

  // Para rúcula: plantas/paquete se calcula automático
  const plantasPorPaqueteAuto = useMemo(() => {
    if (!esPorPaquete || paquetesArmados <= 0) return 0;
    return Math.round((plantasEstimadas / paquetesArmados) * 10) / 10;
  }, [esPorPaquete, plantasEstimadas, paquetesArmados]);

  const esRucula =
    lote.variedad.toLowerCase().includes('rucula') ||
    lote.variedad.toLowerCase().includes('rúcula');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!esPorPaquete && plantasCosechadas <= 0) {
      setError('Ingresá la cantidad de plantas cosechadas');
      setLoading(false);
      return;
    }
    if (esPorPaquete && paquetesArmados <= 0) {
      setError('Ingresá la cantidad de paquetes armados');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/lotes/cosecha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_lote: lote.id_lote,
          fecha,
          es_por_paquete: esPorPaquete,
          plantas_cosechadas: plantasCosechadas,
          descarte: descarteAuto,
          peso_muestra_gr: pesoMuestraGr,
          paquetes_armados: paquetesArmados,
          plantas_por_paquete: plantasPorPaqueteAuto,
          peso_muestra_paquete_gr: pesoMuestraPaqueteGr,
          bandejas_armadas: bandejasArmadas,
          tubos_consumidos_bandejas: tubosConsumidosBandejas,
          peso_muestra_bandeja_gr: pesoMuestraBandejaGr,
          plantas_estimadas_lote: plantasEstimadas,
          usuario,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al registrar cosecha');
      }
      router.push('/cultivos?cosechado=1');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al registrar cosecha');
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
          marginBottom: '14px',
        }}
      >
        <div>
          <label>Fecha de cosecha *</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
            disabled={loading}
          />
        </div>
      </div>

      {/* === LECHUGA: por planta === */}
      {!esPorPaquete && (
        <>
          <div
            style={{
              borderTop: '1px dashed #e5e7eb',
              paddingTop: '14px',
              marginTop: '4px',
            }}
          >
            <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: '#4d7c0f' }}>
              Cosecha por planta
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label>Plantas cosechadas *</label>
                <NumberInput
                  value={plantasCosechadas}
                  onChange={setPlantasCosechadas}
                  min={0}
                  required
                  disabled={loading}
                />
              </div>
              <div>
                <label>Peso de muestra (gramos) — opcional</label>
                <NumberInput
                  value={pesoMuestraGr}
                  onChange={setPesoMuestraGr}
                  min={0}
                  disabled={loading}
                  placeholder="Ej: 82"
                />
              </div>
            </div>
          </div>

          {plantasCosechadas > 0 && (
            <div
              style={{
                marginTop: '12px',
                padding: '10px 12px',
                background: '#f9fafb',
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6b7280' }}>Plantas estimadas del lote</span>
                <span>{plantasEstimadas}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6b7280' }}>Plantas cosechadas</span>
                <span>{plantasCosechadas}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 500,
                  paddingTop: '6px',
                  borderTop: '1px solid #e5e7eb',
                  marginTop: '6px',
                  color: descarteAuto > 0 ? '#dc2626' : '#059669',
                }}
              >
                <span>Descarte automático</span>
                <span>{descarteAuto}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* === RÚCULA / ALBAHACA: por paquete === */}
      {esPorPaquete && (
        <>
          <div
            style={{
              borderTop: '1px dashed #e5e7eb',
              paddingTop: '14px',
              marginTop: '4px',
            }}
          >
            <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: '#166534' }}>
              Destino paquetes (con raíz)
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label>Paquetes armados *</label>
                <NumberInput
                  value={paquetesArmados}
                  onChange={setPaquetesArmados}
                  min={0}
                  required
                  disabled={loading}
                />
              </div>
              <div>
                <label>Peso muestra paquete (gramos) — opcional</label>
                <NumberInput
                  value={pesoMuestraPaqueteGr}
                  onChange={setPesoMuestraPaqueteGr}
                  min={0}
                  disabled={loading}
                  placeholder="Ej: 45"
                />
              </div>
            </div>

            {paquetesArmados > 0 && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px 12px',
                  background: '#f0fdf4',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280' }}>Plantas del lote</span>
                  <span>{plantasEstimadas}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280' }}>Paquetes armados</span>
                  <span>{paquetesArmados}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontWeight: 500,
                    paddingTop: '6px',
                    borderTop: '1px solid #e5e7eb',
                    marginTop: '6px',
                    color: '#166534',
                  }}
                >
                  <span>Plantas/paquete (calculado)</span>
                  <span>{plantasPorPaqueteAuto}</span>
                </div>
              </div>
            )}
          </div>

          {/* Bandejas — solo para rúcula */}
          {esRucula && (
            <div
              style={{
                borderTop: '1px dashed #e5e7eb',
                paddingTop: '14px',
                marginTop: '14px',
              }}
            >
              <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600, color: '#166534' }}>
                Destino bandejas cortadas — opcional
              </p>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#6b7280' }}>
                Si parte del lote se cortó para bandejas, indicá cuántos tubos consumió.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                <div>
                  <label>Bandejas armadas</label>
                  <NumberInput
                    value={bandejasArmadas}
                    onChange={setBandejasArmadas}
                    min={0}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label>Tubos consumidos para bandejas</label>
                  <NumberInput
                    value={tubosConsumidosBandejas}
                    onChange={setTubosConsumidosBandejas}
                    min={0}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label>Peso muestra bandeja (gramos) — opcional</label>
                  <NumberInput
                    value={pesoMuestraBandejaGr}
                    onChange={setPesoMuestraBandejaGr}
                    min={0}
                    disabled={loading}
                    placeholder="Ej: 120"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Guardando…' : 'Registrar cosecha'}
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
