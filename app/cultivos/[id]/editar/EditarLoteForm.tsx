'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Ubicacion } from '@/lib/types';
import NumberInput from '@/components/NumberInput';

interface FechasMov {
  siembra: { id: string; fecha: string };
  f1:      { id: string; fecha: string };
  f2:      { id: string; fecha: string };
  cosecha: { id: string; fecha: string };
}

export default function EditarLoteForm({
  lote, ubicaciones, fechas,
}: {
  lote: Lote;
  ubicaciones: Ubicacion[];
  fechas: FechasMov;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Estado del lote
  const [fase, setFase]     = useState(String(lote.fase_actual || 'plantin'));
  const [estado, setEstado] = useState(String(lote.estado || 'activo'));
  const [ubic, setUbic]     = useState(String(lote.ubicacion_actual || ''));
  const [plantas, setPlantas] = useState(Number(lote.plantas_estimadas_actual) || 0);
  const [tubos, setTubos]   = useState(Number(lote.tubos_ocupados_actual) || 0);
  const [notas, setNotas]   = useState(String(lote.notas || ''));

  // Fechas de movimientos
  const [fechaSiembra,  setFechaSiembra]  = useState(fechas.siembra.fecha);
  const [fechaF1,       setFechaF1]       = useState(fechas.f1.fecha);
  const [fechaF2,       setFechaF2]       = useState(fechas.f2.fecha);
  const [fechaCosecha,  setFechaCosecha]  = useState(fechas.cosecha.fecha);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setMensaje(null);
    try {
      const res = await fetch('/api/lotes/editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_lote: lote.id_lote,
          fase_actual: fase,
          estado,
          ubicacion_actual: ubic,
          plantas_estimadas_actual: plantas,
          tubos_ocupados_actual: tubos,
          notas,
          // Fechas con sus IDs de movimiento para actualizar en la hoja correcta
          fechas: {
            siembra: { id: fechas.siembra.id, fecha: fechaSiembra },
            f1:      { id: fechas.f1.id,      fecha: fechaF1 },
            f2:      { id: fechas.f2.id,      fecha: fechaF2 },
            cosecha: { id: fechas.cosecha.id, fecha: fechaCosecha },
          },
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      setMensaje('Cambios guardados correctamente.');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  }

  const hayF1 = !!fechas.f1.id;
  const hayF2 = !!fechas.f2.id;
  const hayCosecha = !!fechas.cosecha.id;

  return (
    <form onSubmit={handleSubmit}>
      {error   && <div className="alert-box error"   style={{ marginBottom: '14px' }}>{error}</div>}
      {mensaje && <div className="alert-box success" style={{ marginBottom: '14px' }}>{mensaje}</div>}

      {/* FECHAS — sección principal */}
      <div className="card">
        <p className="card-title">Fechas del ciclo</p>
        <p className="card-sub">Corregí las fechas de siembra, trasplantes y cosecha. Afectan directamente el cálculo de días por fase.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>

          <div>
            <label>Fecha de siembra</label>
            <input
              type="date"
              value={fechaSiembra}
              onChange={(e) => setFechaSiembra(e.target.value)}
              disabled={loading}
            />
          </div>

          <div style={{ opacity: hayF1 ? 1 : 0.4 }}>
            <label>
              Trasplante a F1
              {!hayF1 && <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}> — no registrado</span>}
            </label>
            <input
              type="date"
              value={fechaF1}
              onChange={(e) => setFechaF1(e.target.value)}
              disabled={loading || !hayF1}
            />
          </div>

          <div style={{ opacity: hayF2 ? 1 : 0.4 }}>
            <label>
              Trasplante a F2
              {!hayF2 && <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}> — no registrado</span>}
            </label>
            <input
              type="date"
              value={fechaF2}
              onChange={(e) => setFechaF2(e.target.value)}
              disabled={loading || !hayF2}
            />
          </div>

          <div style={{ opacity: hayCosecha ? 1 : 0.4 }}>
            <label>
              Cosecha
              {!hayCosecha && <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}> — no registrada</span>}
            </label>
            <input
              type="date"
              value={fechaCosecha}
              onChange={(e) => setFechaCosecha(e.target.value)}
              disabled={loading || !hayCosecha}
            />
          </div>
        </div>
      </div>

      {/* ESTADO */}
      <div className="card">
        <p className="card-title">Estado del lote</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
          <div>
            <label>Fase actual</label>
            <select value={fase} onChange={(e) => setFase(e.target.value)} disabled={loading}>
              <option value="plantin">Plantinera</option>
              <option value="fase_1">Fase 1</option>
              <option value="fase_2">Fase 2</option>
            </select>
          </div>
          <div>
            <label>Estado</label>
            <select value={estado} onChange={(e) => setEstado(e.target.value)} disabled={loading}>
              <option value="activo">Activo</option>
              <option value="cosechado">Cosechado</option>
              <option value="descartado">Descartado</option>
            </select>
          </div>
          <div>
            <label>Ubicación actual</label>
            <select value={ubic} onChange={(e) => setUbic(e.target.value)} disabled={loading}>
              <option value="">— Sin asignar —</option>
              {ubicaciones.map((u) => (
                <option key={u.id_ubicacion} value={u.nombre}>{u.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Plantas estimadas actuales</label>
            <NumberInput value={plantas} onChange={setPlantas} min={0} disabled={loading} />
          </div>
          <div>
            <label>Tubos ocupados</label>
            <NumberInput value={tubos} onChange={setTubos} min={0} disabled={loading} />
          </div>
        </div>
        <div style={{ marginTop: '14px' }}>
          <label>Notas</label>
          <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} disabled={loading} style={{ resize: 'vertical' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button
          type="button" className="btn secondary"
          onClick={() => router.push('/cultivos/' + encodeURIComponent(lote.id_lote))}
          disabled={loading}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
