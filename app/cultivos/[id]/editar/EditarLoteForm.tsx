// app/cultivos/[id]/editar/EditarLoteForm.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Ubicacion } from '@/lib/types';
import NumberInput from '@/components/NumberInput';

const FASES = [
  { value: 'plantin', label: 'Plantinera' },
  { value: 'fase_1', label: 'Fase 1' },
  { value: 'fase_2', label: 'Fase 2' },
];

const ESTADOS = [
  { value: 'activo', label: 'Activo' },
  { value: 'cosechado', label: 'Cosechado' },
  { value: 'descartado', label: 'Descartado' },
];

export default function EditarLoteForm({
  lote,
  ubicaciones,
}: {
  lote: Lote;
  ubicaciones: Ubicacion[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [faseActual, setFaseActual] = useState<string>(String(lote.fase_actual || 'plantin'));
  const [estado, setEstado] = useState<string>(String(lote.estado || 'activo'));
  const [ubicacionActual, setUbicacionActual] = useState<string>(String(lote.ubicacion_actual || ''));
  const [plantasEstimadas, setPlantasEstimadas] = useState<number>(
    Number(lote.plantas_estimadas_actual) || 0
  );
  const [tubosOcupados, setTubosOcupados] = useState<number>(
    Number(lote.tubos_ocupados_actual) || 0
  );
  const [notas, setNotas] = useState<string>(String(lote.notas || ''));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMensaje(null);
    try {
      const res = await fetch('/api/lotes/editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_lote: lote.id_lote,
          fase_actual: faseActual,
          estado,
          ubicacion_actual: ubicacionActual,
          plantas_estimadas_actual: plantasEstimadas,
          tubos_ocupados_actual: tubosOcupados,
          notas,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Error al guardar');
      }
      setMensaje('Cambios guardados correctamente');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
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
      {mensaje && (
        <div className="alert-box success" style={{ marginBottom: '14px' }}>
          {mensaje}
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
          <label>Fase actual</label>
          <select
            value={faseActual}
            onChange={(e) => setFaseActual(e.target.value)}
            disabled={loading}
          >
            {FASES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Estado</label>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            disabled={loading}
          >
            {ESTADOS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Ubicación actual</label>
          <select
            value={ubicacionActual}
            onChange={(e) => setUbicacionActual(e.target.value)}
            disabled={loading}
          >
            <option value="">— Sin asignar —</option>
            {ubicaciones.map((u) => (
              <option key={u.id_ubicacion} value={u.nombre}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Plantas estimadas actuales</label>
          <NumberInput
            value={plantasEstimadas}
            onChange={setPlantasEstimadas}
            min={0}
            disabled={loading}
          />
        </div>

        <div>
          <label>Tubos ocupados</label>
          <NumberInput
            value={tubosOcupados}
            onChange={setTubosOcupados}
            min={0}
            disabled={loading}
          />
        </div>
      </div>

      <div style={{ marginTop: '14px' }}>
        <label>Notas</label>
        <textarea
          rows={3}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          disabled={loading}
          style={{ resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => router.push(`/cultivos/${encodeURIComponent(lote.id_lote)}`)}
          disabled={loading}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
