'use client';
import { useState } from 'react';
import {
  CONDICIONES_TXT, COND_TEMP_MIN, COND_TEMP_MAX, COND_HUM_MIN, COND_HUM_MAX,
  ALARMA_CONDUCTIVIDAD, ALARMA_PH, fueraDeRangoFoliar, alarmaOsmosis,
  type InstanciaTarea, type EstadoTarea, type CampoRegistro,
} from '@/lib/protocoloTareas';

const COLOR_ESTADO: Record<EstadoTarea, { bg: string; color: string; label: string }> = {
  pendiente:    { bg: '#fffbeb', color: '#92400e', label: 'Pendiente' },
  hecha:        { bg: '#f0fdf4', color: '#166534', label: '✓ Hecha' },
  no_aplica:    { bg: '#f3f4f6', color: '#6b7280', label: 'No se aplica' },
  sin_decidir:  { bg: '#eff6ff', color: '#1d4ed8', label: 'A definir' },
  vencida:      { bg: '#fef2f2', color: '#dc2626', label: 'Sin registrar' },
};

const LABEL_CAMPO: Record<CampoRegistro, string> = {
  temperatura: 'Temperatura (°C)',
  humedad: 'Humedad (%)',
  dosis: 'Dosis aplicada',
  producto: 'Producto',
  ph: 'pH',
  conductividad: 'Conductividad (mS/cm)',
};

const inputStyle: React.CSSProperties = {
  fontSize: '12.5px', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: '5px', width: '100%',
};
const labelStyle: React.CSSProperties = { fontSize: '10.5px', color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: '2px' };

function horaAhora() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDia(fecha: string) {
  const [, m, d] = fecha.split('-');
  return `${d}/${m}`;
}
const icono = (tipo: string) => tipo === 'foliar' ? '🌿' : tipo === 'riego' ? '💧' : '🔬';
// El nombre completo no entra en un cuadrito angosto y tampoco hace falta: el ícono ya
// dice de qué tipo es y la frecuencia va abajo.
const nombreCorto = (nombre: string) => nombre
  .replace('Foliar ', '')
  .replace(' en tanque de riego', '')
  .replace('Medición de agua de ', '')
  .replace(' (a definir)', '');

// Un bloque por TAREA (no uno por día): si la misma tarea quedó sin registrar varios días,
// entra una sola vez con sus fechas adentro. Antes cada día era una tarjeta suelta y dos
// semanas sin usar el protocolo llenaban la pantalla con 24 tarjetas repetidas.
interface Bloque {
  tarea: InstanciaTarea['tarea'];
  principal: InstanciaTarea;      // la de hoy si corresponde hoy; si no, la más reciente sin registrar
  otras: InstanciaTarea[];        // el resto de las fechas sin registrar
}

function armarBloques(tareas: InstanciaTarea[], vencidas: InstanciaTarea[]): Bloque[] {
  const mapa = new Map<string, InstanciaTarea[]>();
  for (const i of [...tareas, ...vencidas]) {
    if (!mapa.has(i.tarea.id)) mapa.set(i.tarea.id, []);
    mapa.get(i.tarea.id)!.push(i);
  }
  const hoyDe = new Set(tareas.map((t) => t.tarea.id + t.fecha));
  return [...mapa.values()].map((lista) => {
    const ordenadas = [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha));
    const principal = ordenadas.find((i) => hoyDe.has(i.tarea.id + i.fecha)) || ordenadas[0];
    return { tarea: principal.tarea, principal, otras: ordenadas.filter((i) => i !== principal) };
  });
}

export default function TareasProtocolo({ tareas, vencidas = [], esAdmin, nombreUsuario, titulo }: {
  tareas: InstanciaTarea[];
  vencidas?: InstanciaTarea[];
  esAdmin: boolean;
  nombreUsuario: string;
  titulo?: string;
}) {
  const bloques = armarBloques(tareas, vencidas);
  if (!bloques.length) return null;
  return (
    <div>
      {titulo && <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 700 }}>{titulo}</p>}
      {/* Todos los pendientes como cuadritos, uno al lado del otro. El que se abre para
          registrar pasa a ocupar el ancho completo: el formulario no entra en una columna. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(215px,1fr))', gap: '8px', alignItems: 'start' }}>
        {bloques.map((b) => (
          <BloqueTarea key={b.tarea.id} bloque={b} esAdmin={esAdmin} nombreUsuario={nombreUsuario} />
        ))}
      </div>
    </div>
  );
}

function BloqueTarea({ bloque, esAdmin, nombreUsuario }: { bloque: Bloque; esAdmin: boolean; nombreUsuario: string }) {
  const { tarea: t, principal, otras } = bloque;
  const [abierto, setAbierto] = useState<'ejecucion' | 'decision' | null>(null);
  const [fechaSel, setFechaSel] = useState(principal.fecha);

  const instSel = [principal, ...otras].find((i) => i.fecha === fechaSel) || principal;
  const est = COLOR_ESTADO[instSel.estado];
  const reg = instSel.registro;
  const expandido = abierto !== null;
  const sinRegistrar = [principal, ...otras].filter((i) => i.estado === 'vencida').length;

  return (
    <div style={{
      border: `1px solid ${principal.estado === 'vencida' ? '#fecaca' : '#e5e7eb'}`,
      borderRadius: '8px', padding: '9px 10px',
      background: principal.estado === 'vencida' ? '#fffbfb' : 'white',
      gridColumn: expandido ? '1 / -1' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px' }}>{icono(t.tipo)}</span>
        <strong style={{ fontSize: '12.5px', color: '#111827' }}>{expandido ? t.nombre : nombreCorto(t.nombre)}</strong>
        <span style={{ background: est.bg, color: est.color, fontSize: '9.5px', fontWeight: 700, padding: '2px 6px', borderRadius: '9px', whiteSpace: 'nowrap' }}>
          {est.label}
        </span>
        {sinRegistrar > 1 && (
          <span style={{ fontSize: '9.5px', fontWeight: 700, color: '#dc2626' }}>×{sinRegistrar}</span>
        )}
      </div>

      <p style={{ margin: '3px 0 0', fontSize: '10px', color: '#9ca3af' }}>
        {principal.estado === 'vencida' ? `Venció ${fmtDia(principal.fecha)}` : t.frecuenciaTxt}
        {instSel.venciaEl && principal.estado !== 'vencida' ? ` · vencía ${fmtDia(instSel.venciaEl)}` : ''}
      </p>

      {instSel.productoDefinido && t.id === 'foliar_sabado' && (
        <p style={{ margin: '3px 0 0', fontSize: '11px', fontWeight: 700, color: '#1d4ed8' }}>→ {instSel.productoDefinido}</p>
      )}

      {/* Colapsado: el rango va en una línea, para que el aviso esté siempre a la vista sin
          ocupar media tarjeta. Abierto: el recuadro completo, como en la especificación. */}
      {t.condicionesFoliares && !expandido && instSel.estado !== 'hecha' && (
        <p style={{ margin: '4px 0 0', fontSize: '9.5px', color: '#dc2626', fontWeight: 600 }}>
          ⚠ {COND_TEMP_MIN}-{COND_TEMP_MAX} °C · {COND_HUM_MIN}-{COND_HUM_MAX}% · sin sol fuerte
        </p>
      )}

      {reg && !expandido && (
        <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#166534' }}>
          {String(reg.estado) === 'no_aplica' ? 'No se aplicó' : `${reg.responsable} · ${reg.hora}`}
          {String(reg.fuera_de_rango) === 'SI' && <span style={{ color: '#dc2626', fontWeight: 700 }}> · fuera de rango</span>}
        </p>
      )}

      {expandido && (
        <>
          <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#6b7280', lineHeight: 1.45 }}>{t.detalle}</p>
          {instSel.aviso && (
            <p style={{ margin: '5px 0 0', fontSize: '11px', color: '#92400e', background: '#fffbeb', padding: '5px 8px', borderRadius: '5px' }}>
              ⚠ {instSel.aviso}
            </p>
          )}
          {t.condicionesFoliares && (
            <div style={{ margin: '7px 0 0', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '7px 9px' }}>
              <p style={{ margin: 0, fontSize: '10.5px', fontWeight: 700, color: '#dc2626' }}>⚠ CONDICIONES PARA APLICAR</p>
              <p style={{ margin: '2px 0 0', fontSize: '10.5px', color: '#991b1b', lineHeight: 1.45 }}>{CONDICIONES_TXT}</p>
            </div>
          )}
          {otras.length > 0 && (
            <div style={{ display: 'flex', gap: '5px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '10.5px', color: '#6b7280' }}>Día a registrar:</span>
              {[principal, ...otras].map((i) => (
                <button key={i.fecha} onClick={() => setFechaSel(i.fecha)}
                  style={{
                    fontSize: '11px', padding: '3px 9px', borderRadius: '5px', cursor: 'pointer', fontWeight: 600,
                    background: fechaSel === i.fecha ? '#111827' : '#fff',
                    color: fechaSel === i.fecha ? 'white' : '#374151',
                    border: '1px solid #e5e7eb',
                  }}>
                  {fmtDia(i.fecha)}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
        {instSel.estado === 'sin_decidir' && (
          esAdmin ? (
            <button onClick={() => setAbierto(abierto === 'decision' ? null : 'decision')} style={btn('#1d4ed8')}>
              {abierto === 'decision' ? 'Cancelar' : 'Definir'}
            </button>
          ) : (
            <span style={{ fontSize: '10px', color: '#6b7280' }}>Espera la definición de Marcelo.</span>
          )
        )}
        {(instSel.estado === 'pendiente' || instSel.estado === 'vencida') && (
          <button onClick={() => setAbierto(abierto === 'ejecucion' ? null : 'ejecucion')} style={btn('#166534')}>
            {abierto === 'ejecucion' ? 'Cancelar' : 'Registrar'}
          </button>
        )}
        {(instSel.estado === 'hecha' || instSel.estado === 'no_aplica') && (
          <button onClick={() => setAbierto(abierto === 'ejecucion' ? null : 'ejecucion')} style={btn('#6b7280', true)}>
            {abierto === 'ejecucion' ? 'Cancelar' : 'Corregir'}
          </button>
        )}
        {t.id === 'foliar_sabado' && esAdmin && instSel.estado !== 'sin_decidir' && instSel.estado !== 'hecha' && (
          <button onClick={() => setAbierto(abierto === 'decision' ? null : 'decision')} style={btn('#1d4ed8', true)}>
            {abierto === 'decision' ? 'Cancelar' : 'Cambiar'}
          </button>
        )}
      </div>

      {abierto && (
        <Formulario
          key={instSel.fecha}
          inst={instSel}
          modo={abierto}
          nombreUsuario={nombreUsuario}
          onCancelar={() => setAbierto(null)}
        />
      )}
    </div>
  );
}

function btn(color: string, suave = false): React.CSSProperties {
  return {
    fontSize: '10.5px', padding: '4px 10px', borderRadius: '5px', cursor: 'pointer', fontWeight: 600,
    background: suave ? '#f3f4f6' : color, color: suave ? color : 'white',
    border: suave ? '1px solid #e5e7eb' : 'none',
  };
}

function Formulario({ inst, modo, nombreUsuario, onCancelar }: {
  inst: InstanciaTarea; modo: 'ejecucion' | 'decision'; nombreUsuario: string; onCancelar: () => void;
}) {
  const t = inst.tarea;
  const reg = inst.registro;
  const [responsable, setResponsable] = useState(String(reg?.responsable || nombreUsuario || ''));
  const [hora, setHora] = useState(String(reg?.hora || horaAhora()));
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const c of t.campos) v[c] = String((reg as any)?.[c] ?? '');
    if (t.id === 'foliar_sabado' && !v.producto) v.producto = inst.productoDefinido || '';
    return v;
  });
  const [notas, setNotas] = useState(String(reg?.notas || ''));
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  const set = (k: string, v: string) => setValores((prev) => ({ ...prev, [k]: v }));

  // Avisos en vivo mientras se carga: no bloquean guardar (si la aplicación YA se hizo hay
  // que poder registrarla como fue), pero dejan claro que quedó fuera de lo recomendado.
  const avisoFoliar = t.condicionesFoliares && valores.temperatura !== '' && valores.humedad !== ''
    && fueraDeRangoFoliar(valores.temperatura, valores.humedad);
  const avisoAgua = t.id === 'control_osmosis' && alarmaOsmosis(valores.conductividad, valores.ph).alarma;

  async function guardar(estado: 'hecha' | 'no_aplica') {
    setLoading(true); setMsg(null);
    try {
      const res = await fetch('/api/protocolo/registrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_tarea: t.id, tipo_registro: modo, fecha: inst.fecha, estado,
          responsable, hora, notas, ...valores,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Error al guardar');
      const extra = j.alarma
        ? ` ⚠ ALARMA: ${(j.motivos || []).join(' · ')}.${j.alarmaEnviada ? ' Se avisó por mail.' : ' (No se pudo enviar el mail — avisá vos.)'}`
        : '';
      setMsg({ t: 'ok', s: `✓ Registrado.${extra} Recargando…` });
      setTimeout(() => window.location.reload(), extra ? 2600 : 1200);
    } catch (e: any) {
      setMsg({ t: 'err', s: e.message || 'Error al guardar' });
      setLoading(false);
    }
  }

  if (modo === 'decision') {
    return (
      <div style={{ marginTop: '9px', borderTop: '1px solid #f3f4f6', paddingTop: '9px' }}>
        <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#6b7280' }}>
          Definí qué se aplica el sábado {fmtDia(inst.fecha)}. El operario recién puede registrar la aplicación después de esto.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '8px' }}>
          <div>
            <label style={labelStyle}>Producto</label>
            <select value={valores.producto || ''} onChange={(e) => set('producto', e.target.value)} disabled={loading} style={inputStyle}>
              <option value="">— Elegir —</option>
              {(t.opciones || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          {valores.producto === 'Otro' && (
            <div>
              <label style={labelStyle}>¿Cuál?</label>
              <input value={notas} onChange={(e) => setNotas(e.target.value)} disabled={loading} style={inputStyle} placeholder="Nombre del producto" />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '7px', marginTop: '9px', flexWrap: 'wrap' }}>
          <button onClick={() => guardar('hecha')} disabled={loading || !valores.producto} style={{ ...btn('#166534'), opacity: loading || !valores.producto ? 0.6 : 1 }}>
            {loading ? 'Guardando…' : 'Confirmar aplicación'}
          </button>
          <button onClick={() => guardar('no_aplica')} disabled={loading} style={btn('#6b7280', true)}>
            Esta semana no se aplica
          </button>
          <button onClick={onCancelar} disabled={loading} style={btn('#6b7280', true)}>Cancelar</button>
        </div>
        {msg && <p style={{ margin: '7px 0 0', fontSize: '11px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: '9px', borderTop: '1px solid #f3f4f6', paddingTop: '9px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '8px' }}>
        <div>
          <label style={labelStyle}>Responsable *</label>
          <input value={responsable} onChange={(e) => setResponsable(e.target.value)} disabled={loading} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Hora *</label>
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} disabled={loading} style={inputStyle} />
        </div>
        {t.campos.map((campo) => (
          <div key={campo}>
            <label style={labelStyle}>{LABEL_CAMPO[campo]} *</label>
            {campo === 'producto' && t.opciones ? (
              <select value={valores[campo] || ''} onChange={(e) => set(campo, e.target.value)} disabled={loading} style={inputStyle}>
                <option value="">— Elegir —</option>
                {t.opciones.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={campo === 'dosis' || campo === 'producto' ? 'text' : 'number'}
                step={campo === 'conductividad' ? '0.01' : campo === 'ph' ? '0.1' : '1'}
                value={valores[campo] || ''}
                onChange={(e) => set(campo, e.target.value)}
                disabled={loading}
                style={inputStyle}
                placeholder={campo === 'dosis' ? 'según marbete' : ''}
              />
            )}
          </div>
        ))}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Notas (opcional)</label>
          <input value={notas} onChange={(e) => setNotas(e.target.value)} disabled={loading} style={inputStyle} />
        </div>
      </div>

      {avisoFoliar && (
        <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#dc2626', fontWeight: 600, background: '#fef2f2', padding: '6px 8px', borderRadius: '5px' }}>
          ⚠ Fuera del rango recomendado ({COND_TEMP_MIN}-{COND_TEMP_MAX} °C · {COND_HUM_MIN}-{COND_HUM_MAX}%). Si todavía no aplicaste, esperá a que mejoren las condiciones. Si ya aplicaste, registralo igual: queda marcado como fuera de rango.
        </p>
      )}
      {avisoAgua && (
        <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#dc2626', fontWeight: 600, background: '#fef2f2', padding: '6px 8px', borderRadius: '5px' }}>
          ⚠ Fuera de límite (conductividad máx. {ALARMA_CONDUCTIVIDAD} mS/cm · pH máx. {ALARMA_PH}). Al guardar se avisa por mail a Marcelo y a Marcos.
        </p>
      )}

      <div style={{ display: 'flex', gap: '7px', marginTop: '9px', flexWrap: 'wrap' }}>
        <button onClick={() => guardar('hecha')} disabled={loading} style={{ ...btn('#166534'), opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Guardando…' : 'Guardar registro'}
        </button>
        <button onClick={() => guardar('no_aplica')} disabled={loading} style={btn('#6b7280', true)}>
          No se aplicó
        </button>
        <button onClick={onCancelar} disabled={loading} style={btn('#6b7280', true)}>Cancelar</button>
      </div>
      {msg && <p style={{ margin: '7px 0 0', fontSize: '11px', fontWeight: 600, color: msg.t === 'ok' ? '#059669' : '#dc2626' }}>{msg.s}</p>}
    </div>
  );
}
