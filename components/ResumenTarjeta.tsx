'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parsearResumen, type LineaResumen } from '@/lib/parseResumen';
import { CATEGORIAS_GASTO, MEDIOS_PAGO } from '@/lib/types';

// ── Pegar el resumen de la tarjeta ───────────────────────────────────────────────────
//
// Treinta consumos con la misma fecha de cierre y el mismo medio de pago, cada uno con su
// categoría. Cargarlos de a uno son treinta formularios por mes; la carga rápida por grilla
// tampoco sirve, porque agrupa por categoría y acá hace falta el detalle de cada consumo.
//
// El parser saca lo que puede y deja el resto para corregir a mano. Lo que no hace es
// adivinar de más: una línea que parece un total viene DESTILDADA, porque cargarla
// duplicaría todo el resumen y es el error más caro que puede cometer esta pantalla.

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

export interface CategoriaPrevia { descripcion: string; categoria: string }

export default function ResumenTarjeta({ categoriasPrevias = [] }: { categoriasPrevias?: CategoriaPrevia[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [medio, setMedio] = useState<string>('VISA');
  const [fechaDefecto, setFechaDefecto] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }));
  const [filas, setFilas] = useState<(LineaResumen & { usar: boolean })[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  // Con qué categoría se cargó antes cada descripción. Si "SHELL" fue combustible el mes
  // pasado, lo más probable es que lo sea otra vez — y son treinta desplegables menos.
  const previas = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categoriasPrevias) {
      const k = String(c.descripcion || '').trim().toUpperCase();
      if (k && !m.has(k)) m.set(k, c.categoria);
    }
    return m;
  }, [categoriasPrevias]);

  function analizar() {
    const anio = Number(fechaDefecto.slice(0, 4)) || new Date().getFullYear();
    const lineas = parsearResumen(texto, anio, (d) => previas.get(d.trim().toUpperCase()) || null);
    setFilas(lineas.map((l) => ({ ...l, usar: !l.esTotal })));
    setMsg(lineas.length ? null : { ok: false, texto: 'No se encontró ningún consumo en ese texto.' });
  }

  const aCargar = filas.filter((f) => f.usar);
  const total = aCargar.reduce((a, f) => a + f.monto, 0);

  async function cargar() {
    if (!aCargar.length) return;
    setGuardando(true); setMsg(null);
    try {
      const r = await fetch('/api/gastos/masivo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medio_pago: medio,
          items: aCargar.map((f) => ({
            // Sin fecha propia va la del cierre: es mejor que rechazar el renglón, y queda
            // visible en la tabla para corregirlo antes de cargar.
            fecha: f.fecha || fechaDefecto,
            descripcion: f.descripcion,
            categoria: f.categoria,
            monto: f.monto,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error === 'nada_valido' ? 'Ningún renglón quedó válido.' : (j?.error || 'No se pudo cargar.'));
      setMsg({ ok: true, texto: `✓ ${j.cargados} gastos cargados por ${fmt$(j.total)}.` });
      setFilas([]); setTexto('');
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo cargar.' });
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <div className="card" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <p className="card-title" style={{ margin: 0 }}>Cargar resumen de tarjeta</p>
          <p className="card-sub" style={{ margin: '2px 0 0' }}>Pegás el resumen y salen todos los consumos juntos, cada uno con su categoría.</p>
        </div>
        <button type="button" className="btn secondary" style={{ fontSize: '13px' }} onClick={() => setAbierto(true)}>Abrir →</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <p className="card-title" style={{ margin: 0 }}>Cargar resumen de tarjeta</p>
        <button type="button" onClick={() => setAbierto(false)} style={{ background: 'none', border: 'none', fontSize: '12px', color: '#2563eb', cursor: 'pointer' }}>Cerrar</button>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', margin: '10px 0' }}>
        <div>
          <label style={{ fontSize: '11px' }}>Medio de pago</label>
          <select value={medio} onChange={(e) => setMedio(e.target.value)} disabled={guardando}>
            {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '11px' }}>Fecha para los que no la traigan</label>
          <input type="date" value={fechaDefecto} onChange={(e) => setFechaDefecto(e.target.value)} disabled={guardando} />
        </div>
      </div>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={'Pegá acá el resumen, un consumo por línea. Por ejemplo:\n12/09  SHELL ESTACION  12.450,00\n15/09  FERRETERIA SUR  8.900,50'}
        rows={6}
        disabled={guardando}
        style={{ width: '100%', fontSize: '12.5px', fontFamily: 'ui-monospace, monospace', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px' }}
      />
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn secondary" style={{ fontSize: '12.5px' }} onClick={analizar} disabled={!texto.trim() || guardando}>
          Analizar
        </button>
        {filas.length > 0 && (
          <span style={{ fontSize: '12px', color: '#6b7280' }}>
            {filas.length} renglones · {aCargar.length} para cargar · {fmt$(total)}
          </span>
        )}
      </div>

      {filas.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', marginTop: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '600px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', color: '#6b7280', fontSize: '11px' }}>
                  <th style={{ padding: '5px 6px', width: '28px' }}></th>
                  <th style={{ padding: '5px 6px', textAlign: 'left' }}>Fecha</th>
                  <th style={{ padding: '5px 6px', textAlign: 'left' }}>Descripción</th>
                  <th style={{ padding: '5px 6px', textAlign: 'left' }}>Categoría</th>
                  <th style={{ padding: '5px 6px', textAlign: 'right' }}>Importe</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f3f4f6', opacity: f.usar ? 1 : 0.5, background: f.esTotal ? '#fffbeb' : undefined }}>
                    <td style={{ padding: '3px 6px' }}>
                      <input type="checkbox" checked={f.usar} disabled={guardando}
                        onChange={() => setFilas((p) => p.map((x, j) => j === i ? { ...x, usar: !x.usar } : x))} />
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      <input type="date" value={f.fecha || fechaDefecto} disabled={guardando}
                        onChange={(e) => setFilas((p) => p.map((x, j) => j === i ? { ...x, fecha: e.target.value } : x))}
                        style={{ fontSize: '11px' }} />
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      <input value={f.descripcion} disabled={guardando}
                        onChange={(e) => setFilas((p) => p.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))}
                        style={{ width: '100%', fontSize: '12px' }} />
                      {f.esTotal && <span style={{ display: 'block', fontSize: '10px', color: '#b45309' }}>parece el total del resumen — cargarlo duplicaría todo</span>}
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      <select value={f.categoria} disabled={guardando}
                        onChange={(e) => setFilas((p) => p.map((x, j) => j === i ? { ...x, categoria: e.target.value } : x))}
                        style={{ fontSize: '11.5px', maxWidth: '190px' }}>
                        {CATEGORIAS_GASTO.filter((c) => c.value !== 'movimiento_interno').map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                      <input type="number" step="any" value={f.monto} disabled={guardando}
                        onChange={(e) => setFilas((p) => p.map((x, j) => j === i ? { ...x, monto: Number(e.target.value) || 0 } : x))}
                        style={{ width: '110px', textAlign: 'right', fontSize: '12px' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" className="btn" style={{ fontSize: '13px', marginTop: '10px' }}
            onClick={cargar} disabled={guardando || !aCargar.length}>
            {guardando ? 'Cargando…' : `Cargar ${aCargar.length} gastos por ${fmt$(total)}`}
          </button>
        </>
      )}

      {msg && <p style={{ margin: '8px 0 0', fontSize: '12.5px', fontWeight: 600, color: msg.ok ? '#059669' : '#dc2626' }}>{msg.texto}</p>}
    </div>
  );
}
