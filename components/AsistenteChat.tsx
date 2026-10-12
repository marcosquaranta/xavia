'use client';
import { useEffect, useRef, useState } from 'react';

// ── El asistente, en el panel ─────────────────────────────────────────────────────────
//
// Preguntas en castellano sobre los datos de la app. Lo que contesta sale de las mismas
// funciones que calculan las pantallas, no de la planilla ni de lo que el modelo crea
// recordar: ver lib/asistente/herramientas.ts.
//
// Va plegado. Abierto de entrada competiría con el trabajo del día, que es lo que el panel
// tiene que mostrar primero; pero plegado y con atajos arriba, el que lo quiere usar lo
// encuentra sin buscar.

interface Msg { rol: 'user' | 'assistant'; texto: string }

const SUGERENCIAS_ADMIN = [
  '¿Cuánto nos debe cada cliente?',
  '¿Qué falta para cerrar el mes?',
  '¿Cuánto dio el resultado del mes pasado?',
  '¿Qué cuenta no cierra contra el banco?',
  '¿Cuánto stock de cubos queda?',
];
const SUGERENCIAS_OPERACION = [
  '¿Qué tareas hay hoy?',
  '¿Cuántas planchas sembramos hoy y de qué?',
  '¿Qué lotes de rúcula hay en F2?',
  '¿Cuántos cubos quedan en stock?',
];

export default function AsistenteChat({ esAdmin, nombre }: { esAdmin: boolean; nombre: string }) {
  const [abierto, setAbierto] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, cargando]);

  async function preguntar(pregunta: string) {
    const q = pregunta.trim();
    if (!q || cargando) return;
    const nuevos: Msg[] = [...msgs, { rol: 'user', texto: q }];
    setMsgs(nuevos); setTexto(''); setError(null); setCargando(true);
    try {
      const r = await fetch('/api/asistente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: nuevos }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMsgs([...nuevos, { rol: 'assistant', texto: String(j.texto || '').trim() || 'No encontré nada para contestar eso.' }]);
    } catch (e: any) {
      setError(e?.message || 'No se pudo consultar.');
    } finally {
      setCargando(false);
    }
  }

  const sugerencias = esAdmin ? SUGERENCIAS_ADMIN : SUGERENCIAS_OPERACION;

  return (
    <div className="card" style={{ marginBottom: '14px', padding: abierto ? '14px 16px' : '10px 14px' }}>
      <div
        onClick={() => setAbierto((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer', flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: '18px', lineHeight: 1 }}>💬</span>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>Preguntale a la app</span>
        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
          {esAdmin ? 'stock, deuda, saldos, resultado, cierre, lotes…' : 'tareas, siembra, lotes y stock'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9ca3af' }}>{abierto ? 'cerrar' : 'abrir'}</span>
      </div>

      {abierto && (
        <div style={{ marginTop: '10px' }}>
          {msgs.length === 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
              {sugerencias.map((s) => (
                <button key={s} type="button" onClick={() => preguntar(s)} disabled={cargando}
                  style={{
                    fontSize: '11.5px', padding: '5px 10px', borderRadius: '14px', cursor: 'pointer',
                    border: '1px solid #e5e7eb', background: '#fafaf9', color: '#374151',
                  }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {msgs.length > 0 && (
            <div style={{ maxHeight: '340px', overflowY: 'auto', marginBottom: '9px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {msgs.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.rol === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '86%', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    padding: '7px 11px', borderRadius: '10px',
                    background: m.rol === 'user' ? '#eff6ff' : '#f8fafc',
                    border: `1px solid ${m.rol === 'user' ? '#bfdbfe' : '#eef2f7'}`,
                    color: '#111827',
                  }}>
                    {m.texto}
                  </div>
                </div>
              ))}
              {cargando && <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>Buscando el dato…</p>}
              <div ref={finRef} />
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); preguntar(texto); }} style={{ display: 'flex', gap: '7px' }}>
            <input
              value={texto} onChange={(e) => setTexto(e.target.value)} disabled={cargando}
              placeholder={esAdmin ? 'Ej: ¿cuánto nos debe Heroica?' : 'Ej: ¿qué siembro hoy?'}
              style={{ flex: 1, fontSize: '13px', padding: '8px 11px', border: '1px solid #e5e7eb', borderRadius: '7px' }}
            />
            <button type="submit" className="btn" disabled={cargando || !texto.trim()} style={{ fontSize: '12.5px' }}>
              {cargando ? '…' : 'Preguntar'}
            </button>
            {msgs.length > 0 && (
              <button type="button" onClick={() => { setMsgs([]); setError(null); }} disabled={cargando}
                className="btn secondary" style={{ fontSize: '12.5px' }}>
                Limpiar
              </button>
            )}
          </form>

          {error && <p style={{ margin: '7px 0 0', fontSize: '12px', color: '#dc2626' }}>{error}</p>}

          <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: '#9ca3af', lineHeight: 1.5 }}>
            Contesta leyendo los mismos cálculos que las pantallas, así que los números coinciden. <strong>No carga ni
            corrige nada</strong>: para eso están las pantallas. Si un dato no está cargado te lo dice, en vez de darte un cero.
            {!esAdmin && ' La información de plata (resultados, deudas, sueldos, precios) es solo para administración.'}
          </p>
        </div>
      )}
    </div>
  );
}
