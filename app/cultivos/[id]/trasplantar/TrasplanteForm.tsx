'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lote, Ubicacion } from '@/lib/types';
import { estimarPlantasActuales } from '@/lib/lotes';
import NumberInput from '@/components/NumberInput';

const HOY = new Date().toISOString().split('T')[0];

export default function TrasplanteForm({
  lote, faseDestino, ubicacionesDestino, usuario, esRucula, nombreCultivo = 'rúcula',
}: {
  lote: Lote;
  faseDestino: 'fase_1' | 'fase_2';
  ubicacionesDestino: Ubicacion[];
  usuario: string;
  esRucula: boolean; // en realidad: "2 celdas por posición" — aplica a rúcula Y albahaca
  nombreCultivo?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState(HOY);
  const [ubicId, setUbicId] = useState(ubicacionesDestino[0]?.id_ubicacion || '');
  const [descarte, setDescarte] = useState(0);
  // Sin selección por defecto — antes quedaba pre-marcado "queda en plantinera" y era
  // fácil confirmar el trasplante sin pensarlo, perdiendo el registro de la pérdida real.
  const [destinoRestante, setDestinoRestante] = useState<'queda' | 'descartar' | null>(null);

  const [tubos, setTubos] = useState(0);
  const [posiciones, setPosiciones] = useState(0);
  const [plantines, setPlantines] = useState(0);

  const ubic = ubicacionesDestino.find((u) => u.id_ubicacion === ubicId);
  const orificios = Number(ubic?.orificios_por_perfil || 0);
  const factor = esRucula ? 2 : 1;
  const labelFactor = esRucula ? `2 plantines/posición (${nombreCultivo})` : `1 plantín/posición (${nombreCultivo})`;

  // Misma función que usa el resto de la app (LoteCard, etc.) — si el lote sigue en
  // plantinera, la cantidad real vive en plantines_iniciales, NUNCA en
  // plantas_estimadas_actual (que es una cantidad de posiciones/tubos, otra unidad).
  // Reimplementar esto acá había causado que, tras dividir un lote en un trasplante
  // parcial, el padre mostrara la mitad de sus plantines disponibles (rúcula = 2
  // plantines/posición) porque el campo equivocado quedaba con un valor > 0.
  const cantidadActual = estimarPlantasActuales(lote, ubicacionesDestino);

  // Entrada por TUBOS → calcula posiciones y plantines
  function handleTubos(val: number) {
    setTubos(val);
    if (orificios > 0) {
      const pos = val * orificios;
      setPosiciones(pos);
      setPlantines(pos * factor);
    }
  }

  // Entrada por POSICIONES → calcula plantines (tubos queda informativo)
  function handlePosiciones(val: number) {
    setPosiciones(val);
    setTubos(orificios > 0 ? Math.round(val / orificios) : 0);
    setPlantines(val * factor);
  }

  // PLANTINES editable manualmente
  function handlePlantines(val: number) {
    setPlantines(val);
  }

  // Cuando cambia la mesada, limpiar
  function handleUbic(id: string) {
    setUbicId(id);
    setTubos(0); setPosiciones(0); setPlantines(0);
  }

  const restante = Math.max(0, cantidadActual - plantines - descarte);
  const plantasQueQuedan = destinoRestante === 'queda' ? restante : 0;
  const descarteFinal = destinoRestante === 'descartar' ? descarte + restante : descarte;
  const hayRestante = restante > 0 && plantines > 0;
  const seDivide = plantasQueQuedan > 0 && plantines > 0;
  const superaDisponibles = plantines + descarte > cantidadActual;
  const faltante = Math.max(0, plantines + descarte - cantidadActual);
  const descartePct = cantidadActual > 0 ? (descarte / cantidadActual) * 100 : 0;
  const descarteAlto = descartePct > 5;

  // Cuánto SÍ alcanza a llenar con lo disponible, para sugerir una corrección
  const maxPosiciones = orificios > 0 ? Math.floor(cantidadActual / factor) : 0;
  const maxTubos = orificios > 0 ? Math.floor(maxPosiciones / orificios) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    if (!ubic) { setError('Seleccioná una mesada destino'); setLoading(false); return; }
    if (plantines <= 0) { setError('Ingresá tubos, posiciones, o la cantidad de plantines a trasplantar'); setLoading(false); return; }
    if (plantines + descarte > cantidadActual) {
      setError('Estás trasplantando ' + (plantines + descarte) + ' pero solo tenés ' + cantidadActual + ' disponibles.');
      setLoading(false); return;
    }
    // Si queda algo sin trasplantar, hay que decidir explícitamente qué pasó con eso
    // (antes quedaba pre-marcado "queda en plantinera" y se podía confirmar sin pensarlo,
    // perdiendo el registro real de la pérdida).
    if (hayRestante && destinoRestante === null) {
      setError(`Decidí qué pasa con los ${restante} plantines que no vas a trasplantar ahora.`);
      setLoading(false); return;
    }
    // Sin restante y sin descarte cargado: confirmar a propósito que no hubo ninguna
    // pérdida, en vez de asumirlo en silencio — es el caso más común de por qué no
    // quedaba registrado ningún descarte en plantín→F1 ni F1→F2.
    if (!hayRestante && descarte === 0 && !window.confirm('No cargaste descarte. ¿Confirmás que no se perdió NINGÚN plantín en este trasplante (100% llegó sano)?')) {
      setLoading(false); return;
    }
    if (descarteAlto && !window.confirm(`Descarte alto: ${descarte} plantines, ${Math.round(descartePct)}% de los disponibles (más de 5%). ¿Confirmás registrar el trasplante igual?`)) {
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

  // Formatear fecha de siembra para mostrar
  function fmtFecha(f: string) {
    if (!f) return '-';
    try { const [y,m,d] = f.split('-'); return `${d}/${m}/${y}`; } catch { return f; }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}

      {/* Info del lote */}
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px', marginBottom: '20px', fontSize: '13px' }}>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <span><span style={{ color: '#6b7280' }}>Lote:</span> <strong>{lote.id_lote}</strong></span>
          <span><span style={{ color: '#6b7280' }}>Variedad:</span> <strong>{lote.variedad}</strong></span>
          <span><span style={{ color: '#6b7280' }}>Sembrado:</span> <strong>{fmtFecha(String(lote.fecha_siembra || ''))}</strong></span>
          <span><span style={{ color: '#6b7280' }}>Disponibles:</span> <strong>{cantidadActual.toLocaleString('es-AR')} plantines</strong></span>
          {lote.semilla_id && <span><span style={{ color: '#6b7280' }}>Semilla:</span> <strong>{lote.semilla_id}</strong></span>}
        </div>
      </div>

      {/* Fecha y mesada */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '24px' }}>
        <div>
          <label>Fecha de trasplante *</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={loading} />
        </div>
        <div>
          <label>Mesada destino *</label>
          <select value={ubicId} onChange={(e) => handleUbic(e.target.value)} required disabled={loading}>
            {ubicacionesDestino.map((u) => (
              <option key={u.id_ubicacion} value={u.id_ubicacion}>{u.nombre}</option>
            ))}
          </select>
          {ubic && (
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>
              {orificios} posiciones/tubo · {labelFactor}
            </p>
          )}
        </div>
      </div>

      {/* Calculadora */}
      {ubic && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 16px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            Calculá por tubos o por posiciones — los plantines se calculan solos
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '14px', marginBottom: '16px' }}>
            {/* TUBOS */}
            <div>
              <label>
                Tubos ocupados
                {orificios > 0 && <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}> → ×{orificios} pos.</span>}
              </label>
              <NumberInput value={tubos} onChange={handleTubos} min={0} disabled={loading} />
            </div>

            {/* POSICIONES */}
            <div>
              <label>
                Posiciones totales
                <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none' }}> → ×{factor} plant.</span>
              </label>
              <NumberInput value={posiciones} onChange={handlePosiciones} min={0} disabled={loading} />
            </div>
          </div>

          {/* PLANTINES — resultado editable */}
          <div style={{ background: superaDisponibles ? '#fee2e2' : plantines > 0 ? '#f0fdf4' : '#f9fafb', border: '1px solid', borderColor: superaDisponibles ? '#fca5a5' : plantines > 0 ? '#86efac' : '#e5e7eb', borderRadius: '8px', padding: '12px 14px' }}>
            <label style={{ color: superaDisponibles ? '#dc2626' : '#059669', textTransform: 'uppercase', letterSpacing: '0.3px', fontSize: '11px', fontWeight: 600 }}>
              Plantines a trasplantar
              <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: '6px' }}>
                (editable si necesitás ajustar)
              </span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
              <div style={{ flex: 1 }}>
                <NumberInput value={plantines} onChange={handlePlantines} min={0} disabled={loading} />
              </div>
              <div style={{ fontSize: '13px' }}>
                {superaDisponibles ? (
                  <div>
                    <span style={{ color: '#dc2626', fontWeight: 500 }}>⚠ Superás los {cantidadActual} disponibles por {faltante}</span>
                    {orificios > 0 && (
                      <div style={{ fontSize: '11px', color: '#991b1b', marginTop: '2px' }}>
                        Con {cantidadActual} plantines alcanzan ~{maxTubos} tubos ({maxPosiciones} posiciones)
                      </div>
                    )}
                  </div>
                ) : plantines > 0 ? (
                  <div>
                    <span style={{ color: '#059669', fontWeight: 500 }}>de {cantidadActual} disponibles</span>
                    {esRucula && plantines > 0 && (
                      <div style={{ fontSize: '11px', color: '#166534', marginTop: '2px' }}>
                        = {Math.round(plantines / 2)} plantas en mesada
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Descarte */}
      <div style={{ marginBottom: '14px', padding: '14px 16px', background: descarteAlto ? '#fef2f2' : '#fafafa', border: `1px solid ${descarteAlto ? '#fecaca' : '#e5e7eb'}`, borderRadius: '8px' }}>
        <label style={{ color: descarteAlto ? '#991b1b' : undefined }}>Plantines perdidos en este trasplante (descarte)</label>
        <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#6b7280' }}>
          Contá los plantines que <strong>no</strong> vas a trasplantar y tampoco quedan sanos en la mesada — muertos, débiles, sin cuajar, etc. No lo dejes en blanco por costumbre: si no hubo pérdida, va a quedar en 0 y te lo vamos a confirmar antes de guardar.
        </p>
        <div style={{ maxWidth: '160px' }}>
          <NumberInput value={descarte} onChange={setDescarte} min={0} disabled={loading} />
        </div>
        {descarte > 0 && (
          <p style={{ margin: '8px 0 0', fontSize: '12px', fontWeight: 700, color: descarteAlto ? '#dc2626' : '#92400e' }}>
            {descarteAlto ? '⚠️ ' : ''}{Math.round(descartePct)}% de los {cantidadActual} disponibles{descarteAlto ? ' (más de 5%)' : ''}
          </p>
        )}
      </div>

      {/* Resumen */}
      {plantines > 0 && (
        <div style={{ padding: '12px 14px', background: '#f9fafb', borderRadius: '6px', fontSize: '12px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#6b7280' }}>Disponibles</span>
            <span>{cantidadActual} plantines</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#6b7280' }}>Plantines a trasplantar</span>
            <span>{plantines}</span>
          </div>
          {esRucula && plantines > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Plantas en mesada (÷ 2)</span>
              <span style={{ fontWeight: 500 }}>{Math.round(plantines / 2)}</span>
            </div>
          )}
          {descarte > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Descarte</span>
              <span>{descarte}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, paddingTop: '6px', borderTop: '1px solid #e5e7eb', marginTop: '6px', color: superaDisponibles ? '#dc2626' : restante > 0 ? '#d97706' : '#059669' }}>
            <span>{superaDisponibles ? 'Faltan plantines' : 'Restante en plantinera'}</span>
            <span>{superaDisponibles ? faltante : restante} plantines</span>
          </div>
        </div>
      )}

      {/* Destino del restante */}
      {hayRestante && (
        <div style={{ padding: '14px 16px', background: destinoRestante ? '#fffbeb' : '#fef2f2', border: `1px solid ${destinoRestante ? '#fde68a' : '#fecaca'}`, borderRadius: '8px', marginBottom: '14px' }}>
          <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: '13px', color: destinoRestante ? '#78350f' : '#991b1b' }}>
            {destinoRestante ? '' : '⚠️ '}¿Qué pasó con los {restante} plantines que no vas a trasplantar ahora? — elegí una opción
          </p>
          <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
            {[
              ['queda', `Siguen sanos en la plantinera (el lote sigue activo con ${restante} plantines, para trasplantar después)`],
              ['descartar', `Se perdieron / no sirven — se suman al descarte y el lote se cierra con 0`],
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
        <button type="submit" className="btn" disabled={loading || !ubic}>
          {loading ? 'Guardando…' : 'Confirmar trasplante'}
        </button>
        <button type="button" className="btn secondary" onClick={() => router.push('/cultivos')} disabled={loading}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
