'use client';
import { useEffect, useState } from 'react';

// ── Generar y mandar remitos ─────────────────────────────────────────────────────────
//
// Vive en el historial porque el remito sale DESPUÉS de facturar: la lista son las
// facturas ya emitidas de los últimos días, y de cada una se arma el remito.
//
// ── Lo que se cuida acá ──
//
// Mandar un remito es mandarle un mail a un cliente: no se deshace. Por eso:
//
//  · se puede ver el PDF antes, de a uno, sin mandar nada;
//  · el mail al que iría está a la vista, y dice si salió de la ficha general o de la de
//    cobranzas, porque no es lo mismo y quien aprieta tiene que saberlo;
//  · los que no tienen mail no se pueden tildar, y se dice cuáles son;
//  · se confirma con los números delante, no con un "¿estás seguro?".

interface RemitoFila {
  numeroFactura: string;
  fecha: string;
  cliente: string;
  sucursales: string[];
  renglones: number;
  total: { unidades: number; kilos: number };
  email: string;
  emailDe: 'general' | 'cobranzas' | 'ninguno';
}

const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : f; };

export default function Remitos({ onCerrar }: { onCerrar: () => void }) {
  const [dias, setDias] = useState(7);
  const [filas, setFilas] = useState<RemitoFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resultado, setResultado] = useState<any>(null);

  useEffect(() => {
    setCargando(true); setErr(null); setResultado(null);
    fetch(`/api/ventas/remitos?dias=${dias}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) { setErr(j.error || 'No se pudieron traer las facturas.'); setFilas([]); return; }
        setFilas(j.remitos || []);
        // Se tildan solas las que tienen mail: es lo que se va a mandar casi siempre, y
        // tildar veinte a mano es la forma más segura de saltearse una.
        setElegidas((j.remitos || []).filter((r: RemitoFila) => r.email).map((r: RemitoFila) => r.numeroFactura));
      })
      .catch(() => setErr('No se pudieron traer las facturas.'))
      .finally(() => setCargando(false));
  }, [dias]);

  const conMail = filas.filter((f) => f.email);
  const sinMail = filas.filter((f) => !f.email);
  const seleccion = filas.filter((f) => elegidas.includes(f.numeroFactura) && f.email);

  function toggle(n: string) {
    setElegidas((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  }

  async function enviar() {
    if (!seleccion.length) return;
    const texto = `Se van a enviar ${seleccion.length} remito(s) por mail, directo al cliente:\n\n`
      + seleccion.slice(0, 12).map((r) => `• ${r.cliente} → ${r.email}`).join('\n')
      + (seleccion.length > 12 ? `\n…y ${seleccion.length - 12} más` : '')
      + '\n\nUn mail enviado no se puede deshacer. ¿Confirmás?';
    if (!window.confirm(texto)) return;
    setEnviando(true); setErr(null);
    try {
      const r = await fetch('/api/ventas/remitos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeros: seleccion.map((x) => x.numeroFactura), dias }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No se pudieron enviar');
      setResultado(j);
      setElegidas([]);
    } catch (e: any) { setErr(e?.message || 'No se pudieron enviar'); }
    setEnviando(false);
  }

  return (
    <div className="card" style={{ marginBottom: '16px', borderLeft: '4px solid #0f766e' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <div>
          <p className="card-title" style={{ margin: 0 }}>Generar remitos</p>
          <p className="card-sub" style={{ margin: '2px 0 0' }}>
            De las facturas ya emitidas. El remito lleva lo entregado y el número de factura, sin precios.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '12px', color: '#6b7280' }}>
            Últimos
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))} disabled={enviando}
              style={{ margin: '0 5px', fontSize: '12px', padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
              {[3, 7, 15, 30].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            días
          </label>
          <button type="button" onClick={onCerrar} className="btn secondary" style={{ fontSize: '12px', padding: '5px 12px' }}>Cerrar</button>
        </div>
      </div>

      {cargando ? (
        <p style={{ margin: '12px 0 0', fontSize: '12.5px', color: '#9ca3af' }}>Buscando facturas…</p>
      ) : err ? (
        <p style={{ margin: '12px 0 0', fontSize: '12.5px', color: '#dc2626', fontWeight: 600 }}>⚠ {err}</p>
      ) : !filas.length ? (
        <p style={{ margin: '12px 0 0', fontSize: '12.5px', color: '#9ca3af' }}>
          No hay facturas emitidas en los últimos {dias} días.
        </p>
      ) : (
        <>
          {resultado && (
            <div style={{ margin: '12px 0 0', padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '7px', fontSize: '12.5px', color: '#166534' }}>
              <p style={{ margin: 0, fontWeight: 700 }}>✓ {resultado.enviados.length} remito(s) enviados.</p>
              {resultado.enviados.length > 0 && (
                <p style={{ margin: '3px 0 0', color: '#15803d' }}>
                  {resultado.enviados.map((e: any) => `${e.cliente} → ${e.email}`).join(' · ')}
                </p>
              )}
              {resultado.fallados?.length > 0 && (
                <p style={{ margin: '6px 0 0', color: '#b91c1c' }}>
                  <strong>{resultado.fallados.length} no salieron:</strong>{' '}
                  {resultado.fallados.map((f: any) => `${f.cliente} (${f.error})`).join(' · ')}
                </p>
              )}
            </div>
          )}

          {/* ── Están todas las que tienen mail, o faltan algunas ─────────────────────
              Antes esto solo se decía abajo de la lista, y los que no tienen mail apenas
              aparecían con la casilla deshabilitada: se leía como que la pantalla no
              andaba, no como que falta un dato. La pregunta "¿hay alguno sin mail?" se
              contesta arriba y en los dos sentidos — también cuando la respuesta es que no. */}
          {sinMail.length > 0 ? (
            <div style={{ margin: '12px 0 8px', padding: '9px 11px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '7px', fontSize: '12.5px', color: '#92400e', lineHeight: 1.55 }}>
              <strong>{sinMail.length} {sinMail.length === 1 ? 'cliente no tiene' : 'clientes no tienen'} mail cargado</strong>, así que
              no se les puede mandar: {sinMail.map((f) => f.cliente).join(', ')}.
              <br />
              Se carga en <strong>Admin → Clientes de venta</strong> (el general, o el de cobranzas). El PDF se puede ver
              y bajar igual, para mandarlo a mano.
            </div>
          ) : (
            <p style={{ margin: '12px 0 8px', fontSize: '12px', color: '#166534' }}>
              ✓ {filas.length === 1 ? 'El cliente tiene' : `Los ${filas.length} clientes tienen`} mail cargado.
            </p>
          )}

          <div style={{ margin: '0 0 8px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Un solo botón que alterna. Dos ("Tildar todas" / "Ninguna") obligan a leer
                cuál de los dos corresponde cada vez. */}
            {(() => {
              const todasTildadas = conMail.length > 0 && seleccion.length === conMail.length;
              return (
                <button type="button" disabled={enviando || !conMail.length}
                  onClick={() => setElegidas(todasTildadas ? [] : conMail.map((f) => f.numeroFactura))}
                  style={{ fontSize: '11.5px', fontWeight: 700, padding: '5px 12px', borderRadius: '7px', cursor: conMail.length ? 'pointer' : 'not-allowed', border: '1px solid #e5e7eb', background: 'white', color: conMail.length ? '#374151' : '#d1d5db' }}>
                  {todasTildadas ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </button>
              );
            })()}
            <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
              {seleccion.length} de {conMail.length} tildadas
              {sinMail.length > 0 && ` · ${sinMail.length} sin mail, no entran`}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filas.map((f) => {
              const tildada = elegidas.includes(f.numeroFactura);
              const sin = !f.email;
              return (
                <label key={f.numeroFactura}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap',
                    padding: '7px 10px', borderRadius: '7px', fontSize: '12.5px',
                    border: `1px solid ${tildada && !sin ? '#99f6e4' : '#f0f0f0'}`,
                    background: sin ? '#fafafa' : tildada ? '#f0fdfa' : 'white',
                    opacity: sin ? 0.75 : 1, cursor: sin ? 'default' : 'pointer',
                  }}>
                  <input type="checkbox" checked={tildada && !sin} disabled={sin || enviando}
                    onChange={() => toggle(f.numeroFactura)} />
                  <span style={{ fontWeight: 700, minWidth: '120px' }}>{f.cliente}</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#1d4ed8' }}>{f.numeroFactura}</span>
                  <span style={{ color: '#6b7280' }}>{fmtDia(f.fecha)}</span>
                  <span style={{ color: '#6b7280', fontSize: '11.5px' }}>
                    {[f.total.unidades > 0 ? `${f.total.unidades} u` : '', f.total.kilos > 0 ? `${f.total.kilos} kg` : ''].filter(Boolean).join(' + ')}
                    {f.sucursales.length > 1 ? ` · ${f.sucursales.length} sucursales` : ''}
                  </span>

                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* De dónde salió el mail. Mandar el remito a la casilla de cobranzas
                        es aceptable pero no es lo mismo, y conviene verlo antes. */}
                    {sin ? (
                      <span style={{ fontSize: '10.5px', color: '#b45309', background: '#fffbeb', padding: '2px 7px', borderRadius: '9px', fontWeight: 700 }}>
                        sin mail cargado
                      </span>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#6b7280' }}>
                        {f.email}
                        {f.emailDe === 'cobranzas' && (
                          <span title="El cliente no tiene mail general: se usa el de cobranzas."
                            style={{ marginLeft: '5px', fontSize: '10px', color: '#92400e', background: '#fef3c7', padding: '1px 6px', borderRadius: '9px', fontWeight: 700 }}>
                            de cobranzas
                          </span>
                        )}
                      </span>
                    )}
                    <a href={`/api/ventas/remitos?dias=${dias}&numero=${encodeURIComponent(f.numeroFactura)}`}
                      target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: '11px', color: '#0f766e', fontWeight: 700 }}>
                      Ver PDF
                    </a>
                  </span>
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px' }}>
            <button type="button" onClick={enviar} disabled={enviando || !seleccion.length} className="btn"
              style={{ fontSize: '12.5px', padding: '7px 15px', background: seleccion.length ? '#0f766e' : '#e5e7eb', color: seleccion.length ? 'white' : '#9ca3af' }}>
              {enviando ? 'Enviando…' : `Enviar ${seleccion.length || ''} remito${seleccion.length === 1 ? '' : 's'} por mail`}
            </button>
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
              Va directo al cliente, con el PDF adjunto. Un mail enviado no se deshace.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
