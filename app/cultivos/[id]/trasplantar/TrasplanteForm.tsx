// app/cultivos/[id]/trasplantar/TrasplanteForm.tsx
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Ubicacion } from '@/lib/types';
import NumberInput from '@/components/NumberInput';

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
  // Decisión: qué pasa con lo que queda en origen
  const [destinoRestante, setDestinoRestante] = useState<'queda' | 'descartar'>('queda');

  const ubicacionDestino = ubicacionesDestino.find(
    (u) => u.id_ubicacion === ubicacionDestinoId
  );

  // Fuente de verdad para cantidad actual: plantas_estimadas_actual si existe, sino plantines_iniciales
  const cantidadActual = useMemo(() => {
    const est = Number(lote.plantas_estimadas_actual);
    if (est && est > 0) return est;
    return Number(lote.plantines_iniciales) || 0;
  }, [lote.plantas_estimadas_actual, lote.plantines_iniciales]);

  // Plantas que se trasplantan = tubos × orificios
  const plantasTrasplantadas = useMemo(() => {
    if (!ubicacionDestino) return 0;
    return tubosOcupados * Number(ubicacionDestino.orificios_por_perfil || 0);
  }, [tubosOcupados, ubicacionDestino]);

  const restanteCalculado = Math.max(
    0,
    cantidadActual - plantasTrasplantadas - descarte
  );

  // Plantas que efectivamente quedan en el lote madre (si descartar = 0)
  const plantasQueQuedan = destinoRestante === 'queda' ? restanteCalculado : 0;
  const descarteFinal = destinoRestante === 'descartar' ? descarte + restanteCalculado : descarte;

  const seDivide = plantasQueQuedan > 0 && plantasTrasplantadas > 0;
  const hayRestante = restanteCalculado > 0 && plantasTrasplantadas > 0;

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
          descarte: descarteFinal,
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
          <NumberInput
            value={tubosOcupados}
            onChange={setTubosOcupados}
            min={0}
            required
            disabled={loading}
          />
        </div>

        <div>
          <label>Descarte detectado al trasplantar</label>
          <NumberInput
            value={descarte}
            onChange={setDescarte}
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
          <span style={{ color: '#6b7280' }}>Plantas que se trasplantan</span>
          <span>{plantasTrasplantadas}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#6b7280' }}>Descarte detectado</span>
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
          <span>Restante calculado</span>
          <span>{restanteCalculado}</span>
        </div>
      </div>

      {/* Pregunta clave: ¿qué hacemos con lo que queda? */}
      {hayRestante && (
        <div
          style={{
            marginTop: '14px',
            padding: '14px 16px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '8px',
          }}
        >
          <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: '13px', color: '#78350f' }}>
            ¿Qué hacemos con las {restanteCalculado} {labelOrigen} restantes?
          </p>
          <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                padding: '8px 12px',
                background: destinoRestante === 'queda' ? '#fef3c7' : 'transparent',
                borderRadius: '6px',
                fontSize: '13px',
                textTransform: 'none',
                letterSpacing: 'normal',
                margin: 0,
                color: '#1f2937',
              }}
            >
              <input
                type="radio"
                name="destinoRestante"
                value="queda"
                checked={destinoRestante === 'queda'}
                onChange={() => setDestinoRestante('queda')}
                disabled={loading}
                style={{ width: 'auto' }}
              />
              <span>
                <strong>Quedan en {lote.fase_actual === 'plantin' ? 'plantinera' : 'F1'}</strong> (el lote
                actual sigue con {restanteCalculado} {labelOrigen})
              </span>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                padding: '8px 12px',
                background: destinoRestante === 'descartar' ? '#fee2e2' : 'transparent',
                borderRadius: '6px',
                fontSize: '13px',
                textTransform: 'none',
                letterSpacing: 'normal',
                margin: 0,
                color: '#1f2937',
              }}
            >
              <input
                type="radio"
                name="destinoRestante"
                value="descartar"
                checked={destinoRestante === 'descartar'}
                onChange={() => setDestinoRestante('descartar')}
                disabled={loading}
                style={{ width: 'auto' }}
              />
              <span>
                <strong>Descarte / desperdicio</strong> (el lote actual se cierra y queda con 0)
              </span>
            </label>
          </div>
        </div>
      )}

      {seDivide && destinoRestante === 'queda' && (
        <div className="alert-box info" style={{ marginTop: '14px' }}>
          <strong>El lote se va a dividir.</strong>
          <br />
          Se trasplantan <strong>{plantasTrasplantadas}</strong> a la nueva ubicación → se crea un lote
          nuevo.
          <br />
          Quedan <strong>{plantasQueQuedan}</strong> en el lote original <code>{lote.id_lote}</code>.
        </div>
      )}

      {hayRestante && destinoRestante === 'descartar' && (
        <div className="alert-box warning" style={{ marginTop: '14px' }}>
          Las <strong>{restanteCalculado}</strong> restantes se contarán como descarte. Se trasplantan{' '}
          <strong>{plantasTrasplantadas}</strong> al destino. El lote original{' '}
          <code>{lote.id_lote}</code> se cerrará con 0 plantas.
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
