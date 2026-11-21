'use client';
import { useState } from 'react';

// ── Cargar el día cliente por cliente ────────────────────────────────────────────────
//
// La pantalla de ventas estaba organizada por ARTÍCULO: tres grillas —paquetes, venta por
// cajón y otros productos— y un mismo cliente apareciendo en varias. La Reina está en dos,
// Villegas en las tres. Para cargarle el día a uno había que buscarlo en cada una y no
// olvidarse de ninguna.
//
// Esto lo da vuelta: se elige el cliente una vez y se carga todo lo suyo junto. Después el
// siguiente. Facturar sigue siendo al final y de una sola vez, desde el mismo botón de
// siempre.
//
// ── Lo que NO hace, a propósito ──
//
// No guarda por su cuenta. Usa las mismas funciones que la grilla —`onChange`, `onBlur`,
// `onChangeKg`, `saveKg`— que llegan por props. Un segundo camino de guardado sería un
// segundo lugar donde se escriben las columnas de Ventas, y eso en esta app ya terminó mal
// tres veces: dos caminos para el mismo dato terminan siendo dos verdades.
//
// Tampoco reemplaza a la grilla. Cargar rúcula a dieciséis clientes de corrido se hace
// mejor en una grilla, y eso lo dijo Juan Pablo antes de que esto existiera. Las dos
// conviven y se elige con un botón.

export interface FilaCliente {
  id_control: string;
  sucursal: string;
  nombre_display?: string;
  nombre_cliente?: string;
}

export interface ArticuloCol { key: string; label: string }

export default function VentasPorCliente({
  filas, articulos, ensaladas, keysKg, labelKg,
  precioDe, q, onChange, onBlur, qKg, onChangeKg, saveKg, kgDe, registrarRefKg,
  facturadoDe, total7d, fecha,
}: {
  filas: FilaCliente[];
  // Los artículos por unidad, los que van aparte (ensaladas) y las claves por kilo. Llegan
  // armados desde la pantalla para que el catálogo sea uno solo: si esta vista tuviera su
  // propia lista, un artículo dado de alta en Admin aparecería en una y no en la otra.
  articulos: ArticuloCol[];
  ensaladas: ArticuloCol[];
  keysKg: string[];
  labelKg: (k: string) => string;
  // El precio de ese artículo para ese cliente y sucursal. 0 = no se le vende.
  precioDe: (id: string, suc: string, key: string) => number;
  q: (id: string, suc: string, key: any) => string;
  onChange: (f: any, key: any, v: string) => void;
  onBlur: (f: any, key: any) => void;
  // OJO: el campo de kilos se carga en CAJONES, no en kilos. `qKg` devuelve cajones y
  // `kgDe` los pasa a kilos, que es la unidad en la que esta el precio y la que va a la
  // hoja. Mostrar el numero del input como si fueran kilos diria 8 kg donde hay 8 cajones
  // —unos 40 kg— y el importe saldria cinco veces mas chico.
  qKg: (id: string, suc: string, key: any) => string;
  kgDe: (key: string, cajones: number) => number;
  onChangeKg: (f: any, key: any, v: string) => void;
  saveKg: (f: any) => void;
  // `saveKg` lee los inputs del DOM, no el estado: sin registrar estos inputs, guardar
  // desde esta vista escribia CEROS y se perdia la venta por kilo sin un solo error.
  registrarRefKg: (f: any, key: string, el: HTMLInputElement | null) => void;
  // Lo que ya se facturó hoy a ese cliente, para no cargarlo dos veces.
  facturadoDe: (id: string, suc: string) => { total: number } | null;
  // Cuánto llevó hace 7 días, como referencia al cargar.
  total7d: (id: string, suc: string) => number;
  fecha: string;
}) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');

  const nombreDe = (f: FilaCliente) => String(f.nombre_display || f.nombre_cliente || f.id_control);
  const clave = (f: FilaCliente) => `${f.id_control}__${f.sucursal}`;

  // Qué artículos se le pueden cargar a este cliente: los que tienen precio. Sin precio
  // Xubio rechaza la factura entera, así que no se ofrecen (ver app/api/lotes/… y la
  // grilla, que hace lo mismo).
  const suyos = (f: FilaCliente, lista: ArticuloCol[]) =>
    lista.filter((a) => precioDe(f.id_control, f.sucursal, a.key) > 0);
  const suyosKg = (f: FilaCliente) =>
    keysKg.filter((k) => precioDe(f.id_control, f.sucursal, k) > 0);

  // Lo cargado AHORA para ese cliente, en unidades y en plata. El importe es lo que
  // convierte una lista de cantidades en algo que se puede revisar de un vistazo.
  function cargado(f: FilaCliente) {
    const detalle: { label: string; cant: number; importe: number; kg?: boolean }[] = [];
    let unidades = 0, kilos = 0, importe = 0;
    for (const a of [...articulos, ...ensaladas]) {
      const cant = Number(q(f.id_control, f.sucursal, a.key)) || 0;
      if (cant <= 0) continue;
      const sub = cant * precioDe(f.id_control, f.sucursal, a.key);
      unidades += cant; importe += sub;
      detalle.push({ label: a.label, cant, importe: sub });
    }
    for (const k of keysKg) {
      const cajones = Number(qKg(f.id_control, f.sucursal, k)) || 0;
      if (cajones <= 0) continue;
      // El precio es por KILO y el campo tiene CAJONES: sin convertir, el importe saldria
      // cinco veces mas chico y nadie lo notaria hasta ver la factura.
      const kg = kgDe(k, cajones);
      const sub = kg * precioDe(f.id_control, f.sucursal, k);
      kilos += kg; importe += sub;
      detalle.push({ label: labelKg(k), cant: cajones, importe: sub, kg: true });
    }
    return { detalle, unidades, kilos, importe };
  }

  const visibles = (() => {
    const t = buscar.trim().toLowerCase();
    if (!t) return filas;
    return filas.filter((f) => nombreDe(f).toLowerCase().includes(t) || String(f.sucursal || '').toLowerCase().includes(t));
  })();

  // El siguiente de la lista, para poder encadenar sin volver al listado. Es lo que hace
  // que cargar veinte clientes no sea veinte idas y vueltas.
  function siguienteDe(f: FilaCliente): FilaCliente | null {
    const i = visibles.findIndex((x) => clave(x) === clave(f));
    return i >= 0 && i < visibles.length - 1 ? visibles[i + 1] : null;
  }

  const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const conCarga = visibles.filter((f) => cargado(f).importe > 0 || cargado(f).unidades > 0 || cargado(f).kilos > 0);
  const totalCargado = conCarga.reduce((a, f) => a + cargado(f).importe, 0);

  const inputStyle = (val: string): React.CSSProperties => ({
    width: '100%', textAlign: 'center', fontSize: '17px', fontWeight: 700,
    border: `2px solid ${Number(val) > 0 ? '#86efac' : '#e5e7eb'}`,
    borderRadius: '8px', padding: '9px 6px',
    background: Number(val) > 0 ? '#f0fdf4' : 'white',
    color: Number(val) > 0 ? '#166534' : '#9ca3af', outline: 'none',
  });

  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar cliente…"
          style={{ flex: '1 1 200px', fontSize: '13px', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
        <span style={{ fontSize: '11.5px', color: '#6b7280' }}>
          {conCarga.length > 0
            ? <><strong style={{ color: '#166534' }}>{conCarga.length}</strong> con carga · <strong>{fmt$(totalCargado)}</strong></>
            : 'Todavía no se cargó nada'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {visibles.map((f) => {
          const k = clave(f);
          const esteAbierto = abierto === k;
          const c = cargado(f);
          const fact = facturadoDe(f.id_control, f.sucursal);
          const ant = total7d(f.id_control, f.sucursal);
          const arts = suyos(f, articulos);
          const ens = suyos(f, ensaladas);
          const kgs = suyosKg(f);
          const sinNada = arts.length === 0 && ens.length === 0 && kgs.length === 0;
          const tieneAlgo = c.unidades > 0 || c.kilos > 0;

          return (
            <div key={k} style={{
              border: `1px solid ${esteAbierto ? '#1d4ed8' : tieneAlgo ? '#86efac' : '#e5e7eb'}`,
              borderRadius: '9px', background: fact ? '#fafafa' : 'white', overflow: 'hidden',
            }}>
              {/* La fila del cliente: estado, qué se le cargó y cuánto. */}
              <button type="button" onClick={() => setAbierto(esteAbierto ? null : k)}
                style={{
                  width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  padding: '9px 12px', display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap',
                }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: fact ? '#9ca3af' : '#111827' }}>
                  {nombreDe(f)}
                </span>
                {f.sucursal && f.sucursal !== nombreDe(f) && (
                  <span style={{ fontSize: '11px', color: '#6b7280', background: '#f3f4f6', padding: '1px 7px', borderRadius: '10px' }}>
                    {f.sucursal}
                  </span>
                )}
                {/* Ya facturado hoy: en gris y dicho, que es lo que evita cargarlo de nuevo. */}
                {fact && (
                  <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '2px 7px', borderRadius: '10px' }}>
                    ya facturado hoy · {fact.total} u
                  </span>
                )}
                {sinNada && (
                  <span title="Este cliente no tiene ningún precio cargado, así que no se le puede cargar nada. Se carga en Admin → Clientes."
                    style={{ fontSize: '10.5px', color: '#b45309', background: '#fffbeb', padding: '2px 7px', borderRadius: '10px', fontWeight: 700 }}>
                    sin precios cargados
                  </span>
                )}

                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {tieneAlgo ? (
                    <>
                      <span style={{ fontSize: '11.5px', color: '#6b7280' }}>
                        {c.detalle.map((d) => `${d.cant}${d.kg ? ' caj' : ''} ${d.label}`).join(' · ')}
                      </span>
                      <strong style={{ fontSize: '13px', color: '#166534' }}>{fmt$(c.importe)}</strong>
                    </>
                  ) : (
                    <span style={{ fontSize: '11.5px', color: '#d1d5db' }}>sin cargar</span>
                  )}
                  <span style={{ color: '#9ca3af', fontSize: '11px' }}>{esteAbierto ? '▲' : '▼'}</span>
                </span>
              </button>

              {esteAbierto && !sinNada && (
                <div style={{ borderTop: '1px solid #e5e7eb', padding: '11px 12px', background: '#fcfcfd' }}>
                  {ant > 0 && (
                    <p style={{ margin: '0 0 9px', fontSize: '11px', color: '#6b7280' }}>
                      Hace 7 días se le cargaron <strong>{ant} u</strong>.
                    </p>
                  )}

                  {arts.length > 0 && (
                    <Grupo titulo="Por unidad">
                      {arts.map((a) => (
                        <Campo key={a.key} label={a.label} precio={precioDe(f.id_control, f.sucursal, a.key)}>
                          <input type="number" min={0} value={q(f.id_control, f.sucursal, a.key)} placeholder="—"
                            onChange={(ev) => onChange(f, a.key, ev.target.value)}
                            onBlur={() => onBlur(f, a.key)}
                            style={inputStyle(q(f.id_control, f.sucursal, a.key))} />
                        </Campo>
                      ))}
                    </Grupo>
                  )}

                  {kgs.length > 0 && (
                    <Grupo titulo="Por cajón (se factura por kilo)">
                      {kgs.map((kk) => {
                        const cajones = Number(qKg(f.id_control, f.sucursal, kk)) || 0;
                        return (
                          <Campo key={kk} label={labelKg(kk)} precio={precioDe(f.id_control, f.sucursal, kk)} unidad="kg"
                            // Lo que se escribe son cajones y lo que se factura son kilos:
                            // el equivalente va debajo del campo, para que la diferencia se
                            // vea mientras se tipea y no en la factura.
                            nota={cajones > 0 ? `${cajones} cajon${cajones === 1 ? '' : 'es'} = ${kgDe(kk, cajones).toFixed(1)} kg` : 'se carga en cajones'}>
                            <input type="number" min={0} step={1} value={qKg(f.id_control, f.sucursal, kk)} placeholder="0"
                              ref={(el) => registrarRefKg(f, kk, el)}
                              onChange={(ev) => onChangeKg(f, kk, ev.target.value)}
                              onBlur={() => saveKg(f)}
                              style={inputStyle(qKg(f.id_control, f.sucursal, kk))} />
                          </Campo>
                        );
                      })}
                    </Grupo>
                  )}

                  {ens.length > 0 && (
                    <Grupo titulo="Otros productos">
                      {ens.map((a) => (
                        <Campo key={a.key} label={a.label} precio={precioDe(f.id_control, f.sucursal, a.key)}>
                          <input type="number" min={0} value={q(f.id_control, f.sucursal, a.key)} placeholder="—"
                            onChange={(ev) => onChange(f, a.key, ev.target.value)}
                            onBlur={() => onBlur(f, a.key)}
                            style={inputStyle(q(f.id_control, f.sucursal, a.key))} />
                        </Campo>
                      ))}
                    </Grupo>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap', marginTop: '11px', paddingTop: '9px', borderTop: '1px solid #f3f4f6' }}>
                    <strong style={{ fontSize: '13.5px', color: c.importe > 0 ? '#166534' : '#9ca3af' }}>
                      {c.importe > 0 ? fmt$(c.importe) : 'Sin cargar'}
                    </strong>
                    {/* Guardar NO factura: deja la venta cargada. Se factura todo junto al
                        final. Decirlo acá evita la pregunta de si ya salió. */}
                    <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>Se guarda solo. Facturar es al final, todo junto.</span>
                    {(() => {
                      const sig = siguienteDe(f);
                      return sig ? (
                        <button type="button" onClick={() => setAbierto(clave(sig))}
                          style={{ marginLeft: 'auto', background: '#1d4ed8', color: 'white', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>
                          Seguir con {nombreDe(sig)}{sig.sucursal && sig.sucursal !== nombreDe(sig) ? ` — ${sig.sucursal}` : ''} →
                        </button>
                      ) : (
                        <button type="button" onClick={() => setAbierto(null)}
                          style={{ marginLeft: 'auto', background: 'white', border: '1px solid #e5e7eb', borderRadius: '7px', padding: '7px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', color: '#374151' }}>
                          Listo
                        </button>
                      );
                    })()}
                  </div>
                </div>
              )}

              {esteAbierto && sinNada && (
                <div style={{ borderTop: '1px solid #e5e7eb', padding: '11px 12px', fontSize: '12px', color: '#92400e', background: '#fffbeb' }}>
                  Este cliente no tiene ningún precio cargado, así que no hay nada que cargarle. Sin precio, Xubio rechaza
                  la factura entera. Se cargan los precios en <strong>Admin → Clientes de venta</strong> y aparece solo.
                </div>
              )}
            </div>
          );
        })}
        {visibles.length === 0 && (
          <p style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', padding: '16px' }}>
            Ningún cliente coincide con &ldquo;{buscar}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <p style={{ margin: '0 0 5px', fontSize: '10px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{titulo}</p>
      {/* Una columna en el celular, varias en la compu. Es la misma carga: en el galpón se
          usa el teléfono, y un campo por línea con números grandes es lo que se puede
          tipear parado. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '8px' }}>
        {children}
      </div>
    </div>
  );
}

function Campo({ label, precio, unidad, nota, children }: { label: string; precio: number; unidad?: string; nota?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#374151', marginBottom: '3px' }}>
        {label}
        {/* El precio al lado del campo: es lo que permite darse cuenta en el momento de que
            una cantidad está en la fila equivocada. */}
        <span style={{ color: '#9ca3af', fontWeight: 400 }}> · ${Math.round(precio).toLocaleString('es-AR')}{unidad ? `/${unidad}` : ''}</span>
      </span>
      {children}
      {nota && <span style={{ display: 'block', fontSize: '10.5px', color: '#92400e', marginTop: '2px' }}>{nota}</span>}
    </label>
  );
}
