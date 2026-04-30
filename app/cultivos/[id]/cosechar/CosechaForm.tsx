// app/cultivos/[id]/cosechar/CosechaForm.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Variedad } from '@/lib/types';

const HOY = new Date().toISOString().split('T')[0];

interface Cosechador {
  email: string;
  nombre: string;
}

export default function CosechaForm({
  lote,
  variedad,
  esPorPaquete,
  cosechadores,
  usuario,
}: {
  lote: Lote;
  variedad: Variedad;
  esPorPaquete: boolean;
  cosechadores: Cosechador[];
  usuario: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fecha, setFecha] = useState(HOY);
  const [cosechador, setCosechador] = useState(usuario);

  // Para lechuga (por planta)
  const [plantasCosechadas, setPlantasCosechadas] = useState(0);
  const [descarte, setDescarte] = useState(0);
  const [pesoMuestraKg, setPesoMuestraKg] = useState(0);

  // Para rúcula/albahaca (por paquete)
  const [paquetesArmados, setPaquetesArmados] = useState(0);
  const [plantasPorPaquete, setPlantasPorPaquete] = useState(
    variedad.plantas_por_unidad_esperado || 3
  );
  const [pesoMuestraPaqueteKg, setPesoMuestraPaqueteKg] = useState(0);
  const [bandejasArmadas, setBandejasArmadas] = useState(0);
  const [tubosConsumidosBandejas, setTubosConsumidosBandejas] = useState(0);
  const [pesoMuestraBandejaKg, setPesoMuestraBandejaKg] = useState(0);

  // Foto (obligatoria en cosecha) — placeholder en esta fase
  const [fotoUrl, setFotoUrl] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!fotoUrl) {
      setError(
        'La foto de muestra es obligatoria. Pegá un link a Drive con la foto del lote cosechado.'
      );
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
          cosechador,
          es_por_paquete: esPorPaquete,
          plantas_cosechadas: plantasCosechadas,
          descarte,
          peso_muestra_kg: pesoMuestraKg,
          paquetes_armados: paquetesArmados,
          plantas_por_paquete: plantasPorPaquete,
          peso_muestra_paquete_kg: pesoMuestraPaqueteKg,
          bandejas_armadas: bandejasArmadas,
          tubos_consumidos_bandejas: tubosConsumidosBandejas,
          peso_muestra_bandeja_kg: pesoMuestraBandejaKg,
          foto_url: fotoUrl,
          usuario,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al cosechar');
      }
      router.push('/cultivos?cosechado=1');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al cosechar');
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
          <label>Fecha de cosecha *</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        <div>
          <label>Cosechador *</label>
          <select
            value={cosechador}
            onChange={(e) => setCosechador(e.target.value)}
            required
            disabled={loading}
          >
            {cosechadores.map((c) => (
              <option key={c.email} value={c.email}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!esPorPaquete && (
        <>
          <h3
            style={{
              margin: '20px 0 10px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#4d7c0f',
              paddingTop: '14px',
              borderTop: '1px dashed #e5e7eb',
            }}
          >
            Cosecha por planta
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '14px',
            }}
          >
            <div>
              <label>Plantas cosechadas *</label>
              <input
                type="number"
                value={plantasCosechadas}
                onChange={(e) => setPlantasCosechadas(Number(e.target.value))}
                min={0}
                required
                disabled={loading}
              />
            </div>
            <div>
              <label>Descarte reportado</label>
              <input
                type="number"
                value={descarte}
                onChange={(e) => setDescarte(Number(e.target.value))}
                min={0}
                disabled={loading}
              />
            </div>
            <div>
              <label>Peso muestra (kg) *</label>
              <input
                type="number"
                step="0.001"
                value={pesoMuestraKg}
                onChange={(e) => setPesoMuestraKg(Number(e.target.value))}
                min={0}
                required
                disabled={loading}
                placeholder="Ej: 0.082"
              />
            </div>
          </div>
        </>
      )}

      {esPorPaquete && (
        <>
          <h3
            style={{
              margin: '20px 0 10px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#166534',
              paddingTop: '14px',
              borderTop: '1px dashed #e5e7eb',
            }}
          >
            Destino paquetes (con raíz)
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '14px',
            }}
          >
            <div>
              <label>Paquetes armados *</label>
              <input
                type="number"
                value={paquetesArmados}
                onChange={(e) => setPaquetesArmados(Number(e.target.value))}
                min={0}
                required
                disabled={loading}
              />
            </div>
            <div>
              <label>
                Plantas por paquete real *
                <span
                  style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}
                >
                  {' '}
                  (esperado: {variedad.plantas_por_unidad_esperado})
                </span>
              </label>
              <input
                type="number"
                step="0.1"
                value={plantasPorPaquete}
                onChange={(e) => setPlantasPorPaquete(Number(e.target.value))}
                min={0}
                required
                disabled={loading}
              />
            </div>
            <div>
              <label>Peso muestra paquete (kg) *</label>
              <input
                type="number"
                step="0.001"
                value={pesoMuestraPaqueteKg}
                onChange={(e) => setPesoMuestraPaqueteKg(Number(e.target.value))}
                min={0}
                required
                disabled={loading}
                placeholder="Ej: 0.045"
              />
            </div>
          </div>

          {/* Bandejas (solo para rúcula, no albahaca) */}
          {variedad.variedad.toLowerCase().includes('rucula') ||
          variedad.variedad.toLowerCase().includes('rúcula') ? (
            <>
              <h3
                style={{
                  margin: '20px 0 10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#166534',
                  paddingTop: '14px',
                  borderTop: '1px dashed #e5e7eb',
                }}
              >
                Destino bandejas cortadas (opcional)
              </h3>
              <p
                style={{
                  margin: '0 0 10px',
                  fontSize: '11px',
                  color: '#6b7280',
                }}
              >
                Si parte del lote se corta para bandejas, indicá cuántos tubos
                consumió.
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '14px',
                }}
              >
                <div>
                  <label>Bandejas armadas</label>
                  <input
                    type="number"
                    value={bandejasArmadas}
                    onChange={(e) => setBandejasArmadas(Number(e.target.value))}
                    min={0}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label>Tubos consumidos para bandejas</label>
                  <input
                    type="number"
                    value={tubosConsumidosBandejas}
                    onChange={(e) =>
                      setTubosConsumidosBandejas(Number(e.target.value))
                    }
                    min={0}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label>Peso muestra bandeja (kg)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={pesoMuestraBandejaKg}
                    onChange={(e) =>
                      setPesoMuestraBandejaKg(Number(e.target.value))
                    }
                    min={0}
                    disabled={loading}
                    placeholder="Ej: 0.12"
                  />
                </div>
              </div>
            </>
          ) : null}
        </>
      )}

      <div
        style={{
          marginTop: '14px',
          padding: '12px 14px',
          background: '#fef3c7',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#d97706',
            fontSize: '20px',
          }}
        >
          ★
        </div>
        <div style={{ flex: 1 }}>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: '#78350f',
            }}
          >
            Foto de muestra (obligatoria) *
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#78350f' }}>
            Subí la foto a Drive y pegá el link compartido aquí.
          </p>
          <input
            type="url"
            value={fotoUrl}
            onChange={(e) => setFotoUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            required
            disabled={loading}
            style={{ marginTop: '8px' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
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
