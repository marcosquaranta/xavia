'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Ubicacion } from '@/lib/types';
import NumberInput from '@/components/NumberInput';

const HOY = new Date().toISOString().split('T')[0];
const PLANTINES_POR_POSICION_RUCULA = 2;

export default function TrasplanteForm({
  lote, faseDestino, ubicacionesDestino, usuario, esRucula,
}: {
  lote: Lote;
  faseDestino: 'fase_1' | 'fase_2';
  ubicacionesDestino: Ubicacion[];
  usuario: string;
  esRucula: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState(HOY);
  const [ubicId, setUbicId] = useState(ubicacionesDestino[0]?.id_ubicacion || '');
  const [descarte, setDescarte] = useState(0);
  const [destinoRestante, setDestinoRestante] = useState<'queda' | 'descartar'>('queda');

  // Los tres campos editables de forma independiente
  const [tubos, setTubos] = useState(0);
  const [posiciones, setPosiciones] = useState(0);
  const [plantines, setPlantines] = useState(0);

  const ubic = ubicacionesDestino.find((u) => u.id_ubicacion === ubicId);
  const orificios = Number(ubic?.orificios_por_perfil || 0);
  const factorPlantines = esRucula ? PLANTINES_POR_POSICION_RUCULA : 1;

  const cantidadActual = (() => {
    const est = Number(lote.plantas_estimadas_actual);
    return est > 0 ? est : Number(lote.plantines_iniciales) || 0;
  })();

  // Cuando cambia la mesada, resetear
  useEffect(() => {
    setTubos(0); setPosiciones(0); setPlantines(0);
  }, [ubicId]);

  // Cascada: tubos → posiciones → plantines
  function handleTubos(val: number) {
    setTubos(val);
    const pos = val * orificios;
    setPosiciones(pos);
    setPlantines(pos * factorPlantines);
  }

  // Cascada inversa parcial: posiciones → tubos (redondeado) → plantines
  function handlePosiciones(val: number) {
    setPosiciones(val);
    setTubos(orificios > 0 ? Math.round(val / orificios) : 0);
    setPlantines(val * factorPlantines);
  }

  // Plantines: editable libremente, no recalcula tubos/posiciones
  function handlePlantines(val: number) {
    setPlantines(val);
  }

  // Botón "Usar todos": calcula desde cantidadActual
  function usarTodos() {
    if (!ubic || orificios === 0) return;
    const tubosNecesarios = Math.ceil(cantidadActual / (orificios * factorPlantines));
    const posicionesResultantes = tubosNecesarios * orificios;
    const plantinesResultantes = posicionesResultantes * factorPlantines;
    setTubos(tubosNecesarios);
    setPosiciones(posicionesResultantes);
    setPlantines(Math.min(plantinesResultantes, cantidadActual));
  }

  const restante = Math.max(0, cantidadActual - plantines - descarte);
  const plantasQueQuedan = destinoRestante === 'queda' ? restante : 0;
  const descarteFinal = destinoRestante === 'descartar' ? descarte + restante : descarte;
  const hayRestante = restante > 0 && plantines > 0;
  const seDivide = plantasQueQuedan > 0 && plantines > 0;
  const labelOrigen = lote.fase_actual === 'plantin' ? 'plantines' : 'plantas';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    if (!ubic) { setError('Seleccioná una ubicación destino'); setLoading(false); return; }
    if (plantines <= 0) { setError('Ingresá la cantidad de plantines a trasplantar'); setLoading(false); return; }
    if (plantines + descarte > cantidadActual) {
      const tubosExactos = Math.ceil(cantidadActual / (orificios * factorPlantines));
      setError(
        'Estás trasplantando ' + plantines + ' plantines pero solo tenés ' + cantidadActual + '. ' +
        (ubic ? 'Para usar todos: ' + tubosExactos + ' tubos (' + tubosExactos * orificios + ' pos × ' + factorPlantines + ' = ' + Math.min(tubosExactos * orificios * factorPlantines, cantidadActual) + ' plantines).' : '')
      );
      setLoading(false); return;
    }
    try {
      const res = await fetch('/api/lotes/trasplante', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_lote: lote.id_lote, fecha,
          ubicacion_destino_id: ubicId,
          tubos_ocupados: tubos,
          plantas_trasplantadas: plantines,
          plantas_quedan: plantasQueQuedan,
          descarte: descarteFinal,
          fase_destino: faseDestino,
          usuario,
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
      router.push('/cultivos'); router.refresh();
    } catch (err: any) { setError(err.message || 'Error'); setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}

      {esRucula && lote.fase_actual === 'plantin' && (
        <div className="alert-box info" style={{ marginBottom: '14px' }}>
          <strong>Rúcula:</strong> 2 plantines por posición de tubo.
        </div>
      )}

      {/* Fecha y mesada */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div>
          <label>Fecha *</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={loading} />
        </div>
        <div>
          <label>Mesada destino *</label>
          <select value={ubicId} onChange={(e) => setUbicId(e.target.value)} required disabled={loading}>
            {ubicacionesDestino.map((u) => <option key={u.id_ubicacion} value={u.id_ubicacion}>{u.nombre}</option>)}
          </select>
        </div>
      </div>

      {/* Calculadora de tubos/posiciones/plantines */}
      {ubic && (
        <>
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', marginBottom: '14px' }}>
            <p style={{ margin: '0 0 14px', fontSize: '13px', fontWeight: 600, color: '#374151' }}>
              Calculadora de trasplante
              <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: '8px', fontSize: '12px' }}>
                {ubic.nombre} · {orificios} pos/tubo{esRucula ? ` · ${factorPlantines} plantines/pos` : ''}
              </span>
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: '8px', alignItems: 'end' }}>
              {/* Tubos */}
              <div>
                <label style={{ color: '#4b5563' }}>Tubos</label>
                <NumberInput value={tubos} onChange={handleTubos} min={0} disabled={loading} />
              </div>

              <div style={{ textAlign: 'center', paddingBottom: '10px', color: '#9ca3af', fontSize: '18px', lineHeight: 1 }}>×</div>

              {/* Posiciones */}
              <div>
                <label style={{ color: '#4b5563' }}>
                  Posiciones
                  <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}> ({orificios}/tubo)</span>
                </label>
                <NumberInput value={posiciones} onChange={handlePosiciones} min={0} disabled={loading} />
              </div>

              {esRucula ? (
                <>
                  <div style={{ textAlign: 'center', paddingBottom: '10px', color: '#9ca3af', fontSize: '18px', lineHeight: 1 }}>×</div>
                  <div>
                    <label style={{ color: '#4b5563' }}>
                      Plantines
                      <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}> (×2)</span>
                    </label>
                    <NumberInput value={plantines} onChange={handlePlantines} min={0} disabled={loading} />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ textAlign: 'center', paddingBottom: '10px', color: '#9ca3af', fontSize: '14px', lineHeight: 1 }}>=</div>
                  <div>
                    <label style={{ color: '#4b5563' }}>Plantines</label>
                    <NumberInput value={plantines} onChange={handlePlantines} min={0} disabled={loading} />
                  </div>
                </>
              )}
            </div>

            {/* Botón usar todos + resumen */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
              <button
                type="button"
                className="btn secondary small"
                onClick={usarTodos}
                disabled={loading || orificios === 0}
              >
                Usar todos mis {cantidadActual} {labelOrigen}
                {orificios > 0 && (
                  <span style={{ color: '#9ca3af', marginLeft: '4px' }}>
                    → {Math.ceil(cantidadActual / (orificios * factorPlantines))} tubos
                  </span>
                )}
              </button>
              {plantines > 0 && (
                <span style={{ fontSize: '13px', fontWeight: 600, color: plantines > cantidadActual ? '#dc2626' : '#059669' }}>
                  {plantines > cantidadActual
                    ? '⚠ Superás los ' + cantidadActual + ' disponibles'
                    : plantines + ' de ' + cantidadActual + ' plantines'}
                </span>
              )}
            </div>
          </div>

          {/* Descarte */}
          <div style={{ marginBottom: '14px', maxWidth: '220px' }}>
            <label>Descarte al trasplantar</label>
            <NumberInput value={descarte} onChange={setDescarte} min={0} disabled={loading} />
          </div>

          {/* Resumen */}
          <div style={{ padding: '12px 14px', background: '#f9fafb', borderRadius: '6px', fontSize: '12px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Disponibles en plantinera</span><span>{cantidadActual} {labelOrigen}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Se trasplantan</span><span>{plantines}</span></div>
            {descarte > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b7280' }}>Descarte</span><span>{descarte}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, paddingTop: '6px', borderTop: '1px solid #e5e7eb', marginTop: '6px', color: restante > 0 ? '#d97706' : '#059669' }}>
              <span>Restante en plantinera</span><span>{restante} {labelOrigen}</span>
            </div>
          </div>
        </>
      )}

      {/* Destino del restante */}
      {hayRestante && (
        <div style={{ marginTop: '4px', padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '14px' }}>
          <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: '13px', color: '#78350f' }}>
            ¿Qué hacemos con los {restante} {labelOrigen} restantes?
          </p>
          <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
            {[
              ['queda', `Quedan en plantinera (el lote sigue con ${restante} ${labelOrigen})`],
              ['descartar', 'Descarte (el lote se cierra con 0)'],
            ].map(([val, label]: any) => (
              <label key={val} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '8px 12px', background: destinoRestante === val ? (val === 'queda' ? '#fef3c7' : '#fee2e2') : 'transparent', borderRadius: '6px', fontSize: '13px', textTransform: 'none', letterSpacing: 'normal', margin: 0, color: '#1f2937' }}>
                <input type="radio" name="destRest" value={val} checked={destinoRestante === val} onChange={() => setDestinoRestante(val as 'queda' | 'descartar')} disabled={loading} style={{ width: 'auto' }} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {seDivide && destinoRestante === 'queda' && (
        <div className="alert-box info" style={{ marginBottom: '14px' }}>
          <strong>El lote se va a dividir.</strong> Se trasplantan <strong>{plantines}</strong> → lote nuevo en {ubic?.nombre}. Quedan <strong>{plantasQueQuedan}</strong> en plantinera.
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" className="btn" disabled={loading}>{loading ? 'Guardando…' : 'Confirmar trasplante'}</button>
        <button type="button" className="btn secondary" onClick={() => router.push('/cultivos')} disabled={loading}>Cancelar</button>
      </div>
    </form>
  );
}
