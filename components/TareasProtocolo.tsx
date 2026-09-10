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
  sin_decidir:  { bg: '#eff6ff', color: '#1d4ed8', label: 'A definir por Marcelo' },
  vencida:      { bg: '#fef2f2', color: '#dc2626', label: 'Vencida — sin registrar' },
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

export default function TareasProtocolo({ tareas, vencidas = [], esAdmin, nombreUsuario, titulo }: {
  tareas: InstanciaTarea[];
  vencidas?: InstanciaTarea[];
  esAdmin: boolean;
  nombreUsuario: string;
  titulo?: string;
}) {
  if (!tareas.length && !vencidas.length) return null;
  return (
    <div>
      {titulo && <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 700 }}>{titulo}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {tareas.map((inst) => (
          <FilaTarea key={inst.tarea.id + inst.fecha} inst={inst} esAdmin={esAdmin} nombreUsuario={nombreUsuario} />
        ))}
        {vencidas.length > 0 && (
          <div style={{ marginTop: '4px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: '#dc2626' }}>
              Sin registrar de días anteriores ({vencidas.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {vencidas.map((inst) => (
                <FilaTarea key={inst.tarea.id + inst.fecha} inst={inst} esAdmin={esAdmin} nombreUsuario={nombreUsuario} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FilaTarea({ inst, esAdmin, nombreUsuario }: { inst: InstanciaTarea; esAdmin: boolean; nombreUsuario: string }) {
  const [abierto, setAbierto] = useState<'ejecucion' | 'decision' | null>(null);
  const t = inst.tarea;
  const est = COLOR_ESTADO[inst.estado];
  const esFoliar = t.condicionesFoliares;
  const reg = inst.registro;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '14px' }}>{t.tipo === 'foliar' ? '🌿' : t.tipo === 'riego' ? '💧' : '🔬'}</span>
        <strong style={{ fontSize: '13px', color: '#111827' }}>{t.nombre}</strong>
        {inst.productoDefinido && t.id === 'foliar_sabado' && (
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8' }}>→ {inst.productoDefinido}</span>
        )}
        <span style={{ background: est.bg, color: est.color, fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px' }}>
          {est.label}{inst.estado === 'vencida' ? ` · ${fmtDia(inst.fecha)}` : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '10.5px', color: '#9ca3af' }}>{t.frecuenciaTxt}</span>
      </div>

      <p style={{ margin: '5px 0 0', fontSize: '11.5px', color: '#6b7280', lineHeight: 1.45 }}>{t.detalle}</p>

      {inst.aviso && (
        <p style={{ margin: '5px 0 0', fontSize: '11px', color: '#92400e', background: '#fffbeb', padding: '5px 8px', borderRadius: '5px' }}>
          ⚠ {inst.aviso}
        </p>
      )}

      {/* El recuadro de condiciones es SOLO un aviso: no se completa, no se tilda. Lo que
          se verifica después es la temperatura y la humedad reales que carga el operario. */}
      {esFoliar && (inst.estado === 'pendiente' || inst.estado === 'sin_decidir' || inst.estado === 'vencida') && (
        <div style={{ margin: '7px 0 0', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '7px 9px' }}>
          <p style={{ margin: 0, fontSize: '10.5px', fontWeight: 700, color: '#dc2626' }}>⚠ CONDICIONES PARA APLICAR</p>
          <p style={{ margin: '2px 0 0', fontSize: '10.5px', color: '#991b1b', lineHeight: 1.45 }}>{CONDICIONES_TXT}</p>
        </div>
      )}

      {reg && (
        <div style={{ margin: '7px 0 0', background: '#fafafa', borderRadius: '6px', padding: '7px 9px', fontSize: '11px', color: '#374151' }}>
          {String(reg.estado) === 'no_aplica' ? (
            <span>No se aplicó · {reg.responsable} · {reg.hora}{reg.notas ? ` · ${reg.notas}` : ''}</span>
          ) : (
            <span>
              {reg.responsable} · {reg.hora}
              {reg.producto ? ` · ${reg.producto}` : ''}
              {reg.dosis ? ` · ${reg.dosis}` : ''}
              {reg.temperatura !== '' && reg.temperatura !== undefined ? ` · ${reg.temperatura} °C` : ''}
              {reg.humedad !== '' && reg.humedad !== undefined ? ` · ${reg.humedad}%` : ''}
              {reg.conductividad !== '' && reg.conductividad !== undefined ? ` · ${reg.conductividad} mS/cm` : ''}
              {reg.ph !== '' && reg.ph !== undefined ? ` · pH ${reg.ph}` : ''}
            </span>
          )}
          {String(reg.fuera_de_rango) === 'SI' && (
            <span style={{ color: '#dc2626', fontWeight: 700 }}> · fuera del rango recomendado</span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '7px', marginTop: '8px', flexWrap: 'wrap' }}>
        {inst.estado === 'sin_decidir' && (
          esAdmin ? (
            <button onClick={() => setAbierto(abierto === 'decision' ? null : 'decision')} style={btn('#1d4ed8')}>
              {abierto === 'decision' ? 'Cancelar' : 'Definir aplicación'}
            </button>
          ) : (
            <span style={{ fontSize: '11px', color: '#6b7280' }}>Esperando que Marcelo defina qué se aplica.</span>
          )
        )}
        {(inst.estado === 'pendiente' || inst.estado === 'vencida') && (
          <button onClick={() => setAbierto(abierto === 'ejecucion' ? null : 'ejecucion')} style={btn('#166534')}>
            {abierto === 'ejecucion' ? 'Cancelar' : 'Registrar'}
          </button>
        )}
        {(inst.estado === 'hecha' || inst.estado === 'no_aplica') && (
          <button onClick={() => setAbierto(abierto === 'ejecucion' ? null : 'ejecucion')} style={btn('#6b7280', true)}>
            {abierto === 'ejecucion' ? 'Cancelar' : 'Corregir'}
          </button>
        )}
        {t.id === 'foliar_sabado' && esAdmin && inst.estado !== 'sin_decidir' && inst.estado !== 'hecha' && (
          <button onClick={() => setAbierto(abierto === 'decision' ? null : 'decision')} style={btn('#1d4ed8', true)}>
            {abierto === 'decision' ? 'Cancelar' : 'Cambiar definición'}
          </button>
        )}
      </div>

      {abierto && (
        <Formulario
          inst={inst}
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
    fontSize: '11px', padding: '4px 11px', borderRadius: '5px', cursor: 'pointer', fontWeight: 600,
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
