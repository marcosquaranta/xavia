// app/admin/naves/NavesForm.tsx
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Ubicacion } from '@/lib/types';

// ── Por qué esta pantalla edita el cultivo y la fase, y no solo la geometría ─────────
//
// Pasar una mesada de rúcula a lechuga es una operación normal: se hace cuando cambia la
// demanda, y cuando se hace hay que hacerla el mismo día, porque Leo tiene que cargar los
// trasplantes en esa mesada. Hasta ahora la pantalla era de solo lectura y decía "edición
// directa en Google Sheets recomendada": eso significa abrir la planilla, buscar la fila y
// escribir a mano tres valores que la app después compara letra por letra.
//
// Lo que cambia junto tiene que editarse junto. El cultivo sin la fase deja una mesada de
// lechuga que no es ni F1 ni F2 y que el plan no cuenta; los orificios sin el cultivo dejan
// la capacidad vieja. Por eso están los tres campos acá y el guardado los manda juntos.

const VARIEDADES = [
  { v: 'rucula', l: 'Rúcula' },
  { v: 'lechuga', l: 'Lechuga' },
  { v: 'albahaca', l: 'Albahaca' },
  { v: 'mixta', l: 'Mixta (cuenta como rúcula)' },
] as const;

const FASES = [
  { v: 'fase_1', l: 'Fase 1' },
  { v: 'fase_2', l: 'Fase 2' },
  { v: 'plantin', l: 'Plantinera' },
] as const;

type Editable = Ubicacion & { _orig: string };

const firma = (u: any) =>
  [u.variedad_asignada, u.sector_fase, Number(u.modulos) || 0, Number(u.perfiles_por_modulo) || 0, Number(u.orificios_por_perfil) || 0].join('|');

const perfilesDe = (u: any) => (Number(u.modulos) || 1) * (Number(u.perfiles_por_modulo) || 0);
const posicionesDe = (u: any) => perfilesDe(u) * (Number(u.orificios_por_perfil) || 0);

// Las mismas tres canastas que arma calcularCapacidad (lib/planificacionServer.ts). Lo que
// se muestra como impacto tiene que ser exactamente lo que el plan va a contar después de
// guardar, no una aproximación parecida.
function canasta(u: Ubicacion): 'ruc' | 'lecF1' | 'lecF2' | null {
  if (u.tipo !== 'mesada' || u.activo !== 'SI') return null;
  if (u.variedad_asignada === 'rucula' || u.variedad_asignada === 'mixta') return 'ruc';
  if (u.variedad_asignada === 'lechuga' && u.sector_fase === 'fase_1') return 'lecF1';
  if (u.variedad_asignada === 'lechuga' && u.sector_fase === 'fase_2') return 'lecF2';
  return null;
}

function totales(items: Ubicacion[], nave: number) {
  const out = { ruc: 0, lecF1: 0, lecF2: 0, sueltas: [] as string[] };
  for (const u of items) {
    if (Number(u.nave) !== nave) continue;
    const c = canasta(u);
    if (!c) {
      if (u.tipo === 'mesada' && u.activo === 'SI') out.sueltas.push(u.nombre);
      continue;
    }
    out[c] += posicionesDe(u);
  }
  return out;
}

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR');

// ── Un desplegable no puede mentir sobre lo que hay guardado ────────────────────────
//
// Si la planilla tiene un valor que no está en la lista —vacío, con mayúscula, "F2"—, un
// <select> no muestra nada raro: muestra la PRIMERA opción. O sea que una mesada sin fase
// se ve como "Fase 1" aunque adentro tenga vacío, y al guardar la API la rechaza por algo
// que en pantalla parecía estar bien puesto.
//
// Así que lo que no está en la lista se agrega como opción propia y se marca. El valor que
// se ve es el que hay.
function opciones(actual: string, lista: readonly { v: string; l: string }[]) {
  const raw = String(actual ?? '');
  if (lista.some((o) => o.v === raw)) return lista;
  return [{ v: raw, l: raw ? `⚠ ${raw} (no reconocido)` : '⚠ sin asignar' }, ...lista];
}

export default function NavesForm({ ubicaciones }: { ubicaciones: Ubicacion[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const original = useMemo(() => ubicaciones.map((u) => ({ ...u, _orig: firma(u) })) as Editable[], [ubicaciones]);
  const [items, setItems] = useState<Editable[]>(original);

  const cambiadas = items.filter((u) => firma(u) !== u._orig);

  function actualizar(id: string, patch: Partial<Ubicacion>) {
    setItems((prev) => prev.map((u) => (u.id_ubicacion === id ? { ...u, ...patch } : u)));
    setMensaje(null);
  }

  async function guardar() {
    if (!cambiadas.length) return;
    setLoading(true); setError(null); setMensaje(null);
    try {
      // Solo van las que cambiaron. Reescribir las treinta filas en cada guardado son treinta
      // oportunidades de pisar algo que tocó otro, para cambiar dos.
      const res = await fetch('/api/admin/naves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ubicaciones: cambiadas.map((u) => ({
            id_ubicacion: u.id_ubicacion, nombre: u.nombre, tipo: u.tipo,
            variedad_asignada: u.variedad_asignada, sector_fase: u.sector_fase,
            modulos: u.modulos, perfiles_por_modulo: u.perfiles_por_modulo,
            orificios_por_perfil: u.orificios_por_perfil,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Error al guardar');
      setItems((prev) => prev.map((u) => ({ ...u, _orig: firma(u) })));
      setMensaje(
        `Guardado. ${cambiadas.length === 1 ? 'La mesada ya cuenta' : `Las ${cambiadas.length} mesadas ya cuentan`} con la configuración nueva: ` +
        'el plan de siembra y los trasplantes la toman desde ahora.',
      );
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  }

  const naves = Array.from(new Set(items.map((u) => Number(u.nave)))).sort();
  const inp: React.CSSProperties = { width: '68px', textAlign: 'right', padding: '4px 6px', fontSize: '13px' };
  const sel: React.CSSProperties = { padding: '4px 6px', fontSize: '13px' };

  const Linea = ({ l, a, b }: { l: string; a: number; b: number }) => {
    const d = b === a ? null : b - a;
    return (
      <span style={{ marginRight: '16px', whiteSpace: 'nowrap' }}>
        {l}: <strong>{fmt(b)}</strong>
        {d !== null && (
          <span style={{ color: d > 0 ? '#059669' : '#dc2626', fontWeight: 700 }}>
            {' '}{d > 0 ? '+' : '−'}{fmt(Math.abs(d))}
          </span>
        )}
      </span>
    );
  };

  return (
    <div>
      {error && <div className="alert-box error" style={{ marginBottom: '14px' }}>{error}</div>}
      {mensaje && <div className="alert-box success" style={{ marginBottom: '14px' }}>{mensaje}</div>}

      {naves.map((nave) => {
        const antes = totales(original, nave);
        const ahora = totales(items, nave);
        const m2 = Number(items.find((u) => Number(u.nave) === nave)?.metros_cuadrados) || 0;
        return (
          <div key={nave} className="card">
            <p className="card-title">Nave {nave}{m2 > 0 ? ` (${m2} m²)` : ''}</p>
            {/* Posiciones por destino: es lo que el plan de siembra va a contar. La capacidad
                total de la nave no dice nada por sí sola — pasar una mesada de rúcula a lechuga
                no la cambia, y sin embargo cambia todo el plan. */}
            <p className="card-sub" style={{ lineHeight: 1.9 }}>
              Posiciones que va a contar el plan —{' '}
              <Linea l="Rúcula" a={antes.ruc} b={ahora.ruc} />
              <Linea l="Lechuga F1" a={antes.lecF1} b={ahora.lecF1} />
              <Linea l="Lechuga F2" a={antes.lecF2} b={ahora.lecF2} />
            </p>
            {ahora.sueltas.length > 0 && (
              <div className="alert-box warn" style={{ marginBottom: '12px', fontSize: '12.5px' }}>
                No cuentan para el plan: <strong>{ahora.sueltas.join(', ')}</strong>. Una mesada de lechuga
                sin Fase 1 ni Fase 2 no entra en ningún cálculo, y no da error en ninguna pantalla.
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Ubicación</th><th>Cultivo</th><th>Fase</th>
                    <th style={{ textAlign: 'right' }}>Mód.</th>
                    <th style={{ textAlign: 'right' }}>Perf./mód</th>
                    <th style={{ textAlign: 'right' }}>Perfiles</th>
                    <th style={{ textAlign: 'right' }}>Pos./perfil</th>
                    <th style={{ textAlign: 'right' }}>Posiciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.filter((u) => Number(u.nave) === nave).map((u) => {
                    const tocada = firma(u) !== u._orig;
                    return (
                      <tr key={u.id_ubicacion} style={{ background: tocada ? '#fffbeb' : undefined }}>
                        <td style={{ fontWeight: tocada ? 700 : 500 }}>
                          {u.nombre}
                          {u.activo !== 'SI' && <span style={{ color: '#9ca3af', fontSize: '11px' }}> · inactiva</span>}
                        </td>
                        <td>
                          <select style={sel} value={u.variedad_asignada} disabled={loading}
                            onChange={(e) => actualizar(u.id_ubicacion, { variedad_asignada: e.target.value as Ubicacion['variedad_asignada'] })}>
                            {opciones(u.variedad_asignada, VARIEDADES).map((v) => <option key={v.v} value={v.v}>{v.l}</option>)}
                          </select>
                        </td>
                        <td>
                          <select style={sel} value={u.sector_fase} disabled={loading}
                            onChange={(e) => actualizar(u.id_ubicacion, { sector_fase: e.target.value as Ubicacion['sector_fase'] })}>
                            {opciones(u.sector_fase, FASES).map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                          </select>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input type="number" min={0} style={inp} value={Number(u.modulos) || 0} disabled={loading}
                            onChange={(e) => actualizar(u.id_ubicacion, { modulos: Number(e.target.value) })} />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input type="number" min={0} style={inp} value={Number(u.perfiles_por_modulo) || 0} disabled={loading}
                            onChange={(e) => actualizar(u.id_ubicacion, { perfiles_por_modulo: Number(e.target.value) })} />
                        </td>
                        {/* Perfiles totales, para poder comparar con "118 perfiles" sin hacer la
                            cuenta: la planilla los guarda partidos en módulos. */}
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>{fmt(perfilesDe(u))}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input type="number" min={0} step="0.01" style={inp} value={Number(u.orificios_por_perfil) || 0} disabled={loading}
                            onChange={(e) => actualizar(u.id_ubicacion, { orificios_por_perfil: Number(e.target.value) })} />
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>{fmt(posicionesDe(u))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={guardar} disabled={loading || !cambiadas.length}>
          {loading ? 'Guardando…' : cambiadas.length ? `Guardar ${cambiadas.length} ${cambiadas.length === 1 ? 'cambio' : 'cambios'}` : 'Sin cambios'}
        </button>
        {cambiadas.length > 0 && !loading && (
          <button type="button" className="btn secondary" onClick={() => { setItems(original); setError(null); setMensaje(null); }}>
            Descartar
          </button>
        )}
        {cambiadas.length > 0 && (
          <span style={{ fontSize: '12.5px', color: '#92400e' }}>
            Sin guardar: {cambiadas.map((u) => u.nombre).join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
