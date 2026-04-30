// app/cultivos/[id]/trasplantar/TrasplanteForm.tsx
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Ubicacion } from '@/lib/types';

const HOY = new Date().toISOString().split('T')[0];

export default function TrasplanteForm({
  lote,
  faseDestino,
  ubicacionesDestino,
  variedadEsRucula,
  usuario,
}: {
  lote: Lote;
  faseDestino: 'fase_1' | 'fase_2';
  ubicacionesDestino: Ubicacion[];
  variedadEsRucula: boolean;
  usuario: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fecha, setFecha] = useState(HOY);
  const [ubicacionDestinoId, setUbicacionDestinoId] = useState(
    ubicacionesDestino[0]?.id_ubicacion || ''
  );
  const [tubosOcupados, setTubosOcupados] = useState(0);
  const [descarte, setDescarte] = useState(0);

  const ubicacionDestino = ubicacionesDestino.find(
    (u) => u.id_ubicacion === ubicacionDestinoId
  );

  // Cuántas plantas/plantines hay actualmente disponibles
  const cantidadActual =
    lote.fase_actual === 'plantin'
      ? Number(lote.plantines_iniciales) || 0
      : Number(lote.plantas_estimadas_actual) || 0;

  // Plantas que se trasplantan = tubos × orificios
  const plantasTrasplantadas = useMemo(() => {
    if (!ubicacionDestino) return 0;
    return tubosOcupados * Number(ubicacionDestino.orificios_por_perfil || 0);
  }, [tubosOcupados, ubicacionDestino]);

  const plantasQueQuedan = Math.max(
    0,
    cantidadActual - plantasTrasplantadas - descarte
  );

  const seDivide = plantasQueQuedan > 0 && plantasTrasplantadas > 0;

  const labelOrigen =
    lote.fase_actual === 'plantin'
      ? 'plantines'
      : lote.fase_actual === 'fase_1'
      ? 'plantas en F1'
      : 'plantas';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!ubicacionDestino) {
      setError('Seleccioná una ubicación destino');
      setLoading(false);
      return;
    }
    if (plantasTrasplantadas <= 0) {
      setError('Tenés que trasplantar al menos un tubo');
      setLoading(false);
      return;
    }
    if (plantasTrasplantadas + descarte > cantidadActual) {
      setError(
        `No podés trasplantar + descartar más de ${cantidadActual} ${labelOrigen}`
      );
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/lotes/trasplante', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_lote: lote.id_lote,
          fecha,
          ubicacion_destino_id: ubicacionDestinoId,
          tubos_ocupados: tubosOcupados,
          plantas_trasplantadas: plantasTrasplantadas,
          plantas_quedan: plantasQueQuedan,
          descarte,
          fase_destino: faseDestino,
          usuario,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al trasplantar');
      }
      router.push('/cultivos');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al trasplantar');
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
          <label>Fecha de trasplante *</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        <div>
          <label>Mesada destino *</label>
          <select
            value={ubicacionDestinoId}
            onChange={(e) => setUbicacionDestinoId(e.target.value)}
            required
            disabled={loading}
          >
            {ubicacionesDestino.map((u) => (
              <option key={u.id_ubicacion} value={u.id_ubicacion}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>
            Tubos ocupados en destino *
            {ubicacionDestino && (
              <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}>
                {' '}
                ({ubicacionDestino.orificios_por_perfil} orif/tubo)
              </span>
            )}
          </label>
          <input
            type="number"
            value={tubosOcupados}
            onChange={(e) => setTubosOcupados(Number(e.target.value))}
            min={0}
            required
            disabled={loading}
          />
        </div>

        <div>
          <label>Descarte (opcional)</label>
          <input
            type="number"
            value={descarte}
            onChange={(e) => setDescarte(Number(e.target.value))}
            min={0}
            disabled={loading}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: '14px',
          padding: '12px 14px',
          background: '#f9fafb',
          borderRadius: '6px',
          fontSize: '12px',
        }}
      >
        <p style={{ margin: '0 0 6px', fontWeight: 500 }}>Cálculo automático</p>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#6b7280' }}>Cantidad actual del lote</span>
          <span>
            {cantidadActual} {labelOrigen}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#6b7280' }}>
            Plantas que se trasplantan ({tubosOcupados} tubos × ?{' '}
            orif)
          </span>
          <span>{plantasTrasplantadas}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#6b7280' }}>Descarte</span>
          <span>{descarte}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            paddingTop: '6px',
            borderTop: '1px solid #e5e7eb',
            marginTop: '6px',
            fontWeight: 500,
          }}
        >
          <span>Quedan en {lote.fase_actual === 'plantin' ? 'plantinera' : 'F1'}</span>
          <span>{plantasQueQuedan}</span>
        </div>
      </div>

      {seDivide && (
        <div className="alert-box info" style={{ marginTop: '14px' }}>
          <strong>Atención: el lote se va a dividir.</strong>
          <br />
          Se trasplantan <strong>{plantasTrasplantadas}</strong> a la nueva ubicación →
          se crea un lote nuevo con un ID nuevo.
          <br />
          Quedan <strong>{plantasQueQuedan}</strong> plantines/plantas en la ubicación
          actual → el lote <code>{lote.id_lote}</code> sigue con esa cantidad.
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Guardando…' : 'Confirmar trasplante'}
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
