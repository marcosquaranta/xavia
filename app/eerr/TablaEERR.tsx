'use client';
import { useState } from 'react';
import type { EERR } from '@/lib/eerr';

// Tabla del EERR con las mismas líneas que el Excel, en el mismo orden y aunque el mes no
// tenga movimiento — si las líneas aparecen y desaparecen según el mes no se puede comparar
// una columna con la otra.
//
// ── El orden de las columnas es el orden en que se lee ───────────────────────────────────
//
//   CONCEPTO │ este mes │ % ventas │ mes pasado │ Δ $ │ Δ p.p. │ compró │ Δ stock
//
// Primero el resultado de este mes, después contra qué se compara, después la variación, y
// al final la explicación de dónde salió. Las dos últimas son explicativas —no son el dato,
// son el porqué— y por eso van más apagadas y agrupadas aparte.
//
// La variación va en DOS números porque responden cosas distintas y pueden ir para lados
// opuestos: Δ $ es cuánta plata más salió de la caja, Δ p.p. es cuánto cambió el PESO de esa
// línea sobre las ventas. Un costo puede salir medio millón más caro y a la vez pesar menos,
// si las ventas subieron más que él. Con uno solo de los dos, la mitad de los meses se lee
// mal.

const $ = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-AR')}`;
const pesoPct = (monto: number, ventas: number) => (ventas > 0 ? (monto / ventas) * 100 : null);
const fmtPeso = (p: number | null) => (p === null ? '—' : `${p.toFixed(1).replace('.', ',')}%`);
// Puntos porcentuales, dicho así. Es variación del peso sobre ventas, y escribirlo como "%"
// hacía leer "subió 2,9%" cuando lo que subió fueron 2,9 puntos de participación: dos cosas
// distintas que en un EERR llevan a conclusiones distintas.
const fmtPP = (d: number) => `${Math.abs(d).toFixed(1).replace('.', ',')} p.p.`;

// ── Materialidad: cuándo un número merece color ──────────────────────────────────────────
//
// Pintar de rojo toda diferencia positiva es lo mismo que no pintar nada: con veinte líneas
// en rojo no se sabe cuál mirar. Un costo que subió $8.000 en un mes de $20 millones no es
// una noticia, y ocupaba el mismo rojo que uno que subió medio millón.
//
// Los umbrales son RELATIVOS A LAS VENTAS DEL MES, no importes fijos: así siguen significando
// lo mismo cuando la facturación sea el doble, sin que nadie tenga que volver a tocarlos.
const UMBRAL_PP_CHICO = 0.3;    // menos de 0,3 p.p. de participación: ruido
const UMBRAL_PP_GRANDE = 1.0;   // más de 1 p.p.: cambió de verdad el peso del rubro
const UMBRAL_$_CHICO = 0.005;   // 0,5% de las ventas del mes
const UMBRAL_$_GRANDE = 0.015;  // 1,5% de las ventas del mes

type Magnitud = 'nula' | 'chica' | 'moderada' | 'grande';

const COLOR = {
  neutro: '#9ca3af',
  bueno: '#059669',
  moderado: '#b45309',
  malo: '#dc2626',
};

// Verde para cualquier mejora material: una mejora no necesita graduarse, se celebra igual.
// El naranja y el rojo son para empeoramientos, y ahí sí importa el tamaño — es la diferencia
// entre "anotalo" y "andá a ver qué pasó".
function colorDe(magnitud: Magnitud, mejora: boolean): string {
  if (magnitud === 'nula' || magnitud === 'chica') return COLOR.neutro;
  if (mejora) return COLOR.bueno;
  return magnitud === 'grande' ? COLOR.malo : COLOR.moderado;
}

function magnitudPP(d: number): Magnitud {
  const a = Math.abs(d);
  if (a < 0.05) return 'nula';
  if (a < UMBRAL_PP_CHICO) return 'chica';
  return a < UMBRAL_PP_GRANDE ? 'moderada' : 'grande';
}

function magnitudMonto(d: number, ventas: number): Magnitud {
  if (d === 0) return 'nula';
  // Sin ventas no hay escala contra la cual medir si algo es grande. Antes que inventar una,
  // se trata todo como chico: el número se muestra, pero en gris y sin gritar.
  if (!(ventas > 0)) return 'chica';
  const rel = Math.abs(d) / ventas;
  if (rel < UMBRAL_$_CHICO) return 'chica';
  return rel < UMBRAL_$_GRANDE ? 'moderada' : 'grande';
}

const cel: React.CSSProperties = { padding: '6px 10px', fontSize: '13px' };
const celNum: React.CSSProperties = { ...cel, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

// El bloque de variación es el que hay que ver primero: separador a la izquierda y un fondo
// apenas más oscuro que el papel. El de stock es explicativo y va al revés — sin fondo, con
// la línea más suave y el texto apagado.
const BLOQUE_VAR: React.CSSProperties = { borderLeft: '1px solid #e7e5e0', background: 'rgba(17,24,39,0.018)' };
const BLOQUE_STOCK: React.CSSProperties = { borderLeft: '1px solid #f3f4f6' };

export interface DetalleLinea {
  items: { id_gasto: string; fecha: string; descripcion: string; monto: number; medio_pago: string; categoria: string }[];
  // Las líneas que salen de Stocks muestran COMPRAS, que no suman lo mismo que la línea: la
  // línea es consumo. Se avisa en vez de esconderlo, porque un detalle que no cierra con su
  // total y no explica por qué hace dudar del total entero.
  esCompra: boolean;
}

export default function TablaEERR({ act, ant, nombre, nombrePrev, detalle = {}, desglose }: {
  act: EERR; ant: EERR; nombre: string; nombrePrev: string;
  detalle?: Record<string, DetalleLinea>;
  // Las ventas abiertas por artículo y por cliente. Van plegadas: el EERR es un resumen y
  // dos listas largas arriba de todo lo convierten en otra cosa.
  desglose?: { porArticulo: { label: string; unidades: number; monto: number }[]; porCliente: { label: string; unidades: number; monto: number }[] };
}) {
  const [abierto, setAbierto] = useState<Record<string, boolean>>({ variable: true, fijos: true, ventas: false });
  // Qué línea tiene el detalle abierto. Una sola a la vez: abrir varias convierte la tabla
  // en una lista larga y se pierde la comparación entre líneas, que es para lo que sirve.
  const [lineaAbierta, setLineaAbierta] = useState<string | null>(null);
  const toggle = (k: string) => setAbierto((p) => ({ ...p, [k]: !p[k] }));

  const montoAnt = (label: string, lineas: { label: string; monto: number }[]) =>
    lineas.find((l) => l.label === label)?.monto ?? 0;

  // Delta en puntos porcentuales sobre ventas. Sin ventas en alguno de los dos meses no hay
  // peso que comparar y se muestra vacío en vez de un número inventado.
  function delta(monto: number, anterior: number): number | null {
    const a = pesoPct(monto, act.ventas.total), b = pesoPct(anterior, ant.ventas.total);
    return a === null || b === null ? null : a - b;
  }

  function Delta({ monto, anterior, invertido = false, fuerte = false }: { monto: number; anterior: number; invertido?: boolean; fuerte?: boolean }) {
    const d = delta(monto, anterior);
    if (d === null) return <span style={{ color: '#d1d5db' }}>—</span>;
    const mag = magnitudPP(d);
    if (mag === 'nula') return <span style={{ color: COLOR.neutro }}>·</span>;
    const mejora = invertido ? d > 0 : d < 0;
    return (
      <span style={{ color: colorDe(mag, mejora), fontWeight: fuerte ? 700 : 600 }}>
        {d > 0 ? '↑' : '↓'} {fmtPP(d)}
      </span>
    );
  }

  // La diferencia en plata contra el mes pasado. Va al lado del delta en peso y no en su
  // lugar porque las dos responden cosas distintas: el peso dice si el negocio mejoró, la
  // plata dice cuánto más salió de la caja.
  function DeltaMonto({ monto, anterior, invertido = false, fuerte = false }: { monto: number; anterior: number; invertido?: boolean; fuerte?: boolean }) {
    const d = Math.round(monto) - Math.round(anterior);
    // Una línea que no existía el mes pasado SÍ tiene diferencia en plata —son $500.000 más
    // que salieron de la caja, y eso es cierto— aunque no tenga porcentaje. El que queda sin
    // definir es el %, y ese es el que se muestra vacío en la otra columna.
    if (!monto && !anterior) return <span style={{ color: '#d1d5db' }}>—</span>;
    const mag = magnitudMonto(d, act.ventas.total);
    if (mag === 'nula') return <span style={{ color: COLOR.neutro }}>·</span>;
    const mejora = invertido ? d > 0 : d < 0;
    return (
      <span style={{ color: colorDe(mag, mejora), fontWeight: fuerte ? 700 : 600 }}>
        {d > 0 ? '↑' : '↓'} {$(Math.abs(d))}
      </span>
    );
  }

  function Fila({ label, monto, anterior, nivel, invertido, seccion, cantidad, compras, variacionStock, primerResultado }: {
    label: string; monto: number; anterior: number;
    nivel: 'total' | 'detalle' | 'resultado'; invertido?: boolean; seccion?: string; cantidad?: string;
    compras?: number; variacionStock?: number;
    // El primer resultado abre el bloque de cierre: línea más marcada y aire arriba, para que
    // se lea como otra cosa y no como una línea más de costos.
    primerResultado?: boolean;
  }) {
    const esTotal = nivel === 'total', esRes = nivel === 'resultado';
    const clickeable = !!seccion;
    // Los totales de sección llevan un gris muy suave: alcanza para que el ojo los encuentre
    // sin tener que mirar, y no agrega una línea más.
    const fondo = esTotal ? 'rgba(17,24,39,0.028)' : undefined;
    const padV = esRes ? '11px 10px' : esTotal ? '8px 10px' : '6px 10px';
    const base: React.CSSProperties = { ...cel, padding: padV };
    const num: React.CSSProperties = { ...celNum, padding: padV };
    return (
      <tr style={{
        background: fondo,
        borderTop: primerResultado ? '2px solid #d1d5db' : esTotal || esRes ? '1px solid #e5e7eb' : '1px solid #f6f6f4',
      }}>
        <td style={{ ...base, paddingLeft: esTotal || esRes ? '10px' : '30px' }}>
          {clickeable ? (
            <button onClick={() => toggle(seccion!)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#9ca3af', fontSize: '10px', width: '9px' }}>{abierto[seccion!] ? '▾' : '▸'}</span>
              <span style={{ fontWeight: 800, fontSize: '12.5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
            </button>
          ) : (
            (() => {
              const det = detalle[label];
              const hayDetalle = nivel === 'detalle' && !!det && det.items.length > 0;
              const contenido = (
                <>
                  {label}
                  {cantidad && <span style={{ color: '#9ca3af', fontSize: '11.5px' }}> · {cantidad}</span>}
                  {hayDetalle && (
                    <span style={{ color: '#9ca3af', fontSize: '10px' }}> {lineaAbierta === label ? '▾' : '▸'} {det.items.length}</span>
                  )}
                </>
              );
              if (!hayDetalle) {
                return (
                  <span style={{ fontWeight: esRes ? 800 : 400, fontSize: esRes ? '14px' : '13px' }}>{contenido}</span>
                );
              }
              return (
                <button onClick={() => setLineaAbierta((p) => (p === label ? null : label))}
                  title="Ver los movimientos de esta línea"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: '#1d4ed8', textAlign: 'left' }}>
                  {contenido}
                </button>
              );
            })()
          )}
        </td>

        {/* ── Este mes ── */}
        <td style={{ ...num, fontWeight: esTotal || esRes ? 800 : 500, fontSize: esRes ? '16px' : '13px', color: esRes && monto < 0 ? COLOR.malo : '#111827' }}>
          {$(monto)}
        </td>
        <td style={{ ...num, fontSize: '12px', color: '#6b7280' }}>{fmtPeso(pesoPct(monto, act.ventas.total))}</td>

        {/* ── Contra qué se compara ── */}
        <td style={{ ...num, fontSize: '12px', color: '#9ca3af' }}>{$(anterior)}</td>

        {/* ── Variación ── */}
        <td style={{ ...num, ...BLOQUE_VAR, fontSize: esRes ? '13px' : '12px' }}>
          <DeltaMonto monto={monto} anterior={anterior} invertido={invertido} fuerte={esTotal || esRes} />
        </td>
        <td style={{ ...num, background: BLOQUE_VAR.background, fontSize: esRes ? '13px' : '12px' }}>
          <Delta monto={monto} anterior={anterior} invertido={invertido} fuerte={esTotal || esRes} />
        </td>

        {/* ── Movimiento de stock ──
            Solo tiene sentido en las líneas que salen de stock. El costo del mes es el
            CONSUMO, no la compra: un mes se puede comprar el triple de lo que se consume y
            el costo no se mueve. Verlas al lado es lo que evita leer la compra como costo. */}
        <td style={{ ...num, ...BLOQUE_STOCK, fontSize: '11.5px', color: '#9ca3af' }}>
          {compras === undefined ? '' : compras ? $(compras) : '—'}
        </td>
        <td style={{ ...num, fontSize: '11.5px', color: variacionStock && variacionStock > 0 ? '#b45309' : '#9ca3af' }}>
          {variacionStock === undefined ? '' : variacionStock ? `${variacionStock > 0 ? '+' : '−'}${$(Math.abs(variacionStock))}` : '—'}
        </td>
      </tr>
    );
  }

  function DetalleDe({ label }: { label: string }) {
    if (lineaAbierta !== label) return null;
    const det = detalle[label];
    if (!det || !det.items.length) return null;
    const suma = det.items.reduce((a, g) => a + g.monto, 0);
    return (
      <tr>
        <td colSpan={8} style={{ padding: '0 10px 10px 30px', background: '#fafaf9' }}>
          <p style={{ margin: '0 0 5px', fontSize: '11px', color: '#6b7280' }}>
            {det.esCompra
              ? `Compras del mes de estos artículos — ${$(suma)}. La línea de arriba es el CONSUMO (había + compró − quedó), así que no tiene por qué dar lo mismo.`
              : `${det.items.length} movimiento(s) · ${$(suma)}`}
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
            <tbody>
              {det.items.map((g) => (
                <tr key={g.id_gasto} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '3px 8px 3px 0', color: '#6b7280', whiteSpace: 'nowrap', width: '70px' }}>
                    {g.fecha.slice(8, 10)}/{g.fecha.slice(5, 7)}
                  </td>
                  <td style={{ padding: '3px 8px 3px 0' }}>{g.descripcion || <span style={{ color: '#d1d5db' }}>sin detalle</span>}</td>
                  <td style={{ padding: '3px 8px 3px 0', color: '#9ca3af', whiteSpace: 'nowrap' }}>{g.medio_pago}</td>
                  <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {$(g.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </td>
      </tr>
    );
  }

  const varVentas = ant.ventas.total > 0 ? ((act.ventas.total - ant.ventas.total) / ant.ventas.total) * 100 : null;

  const thBase: React.CSSProperties = {
    ...cel, padding: '7px 10px', fontSize: '10.5px', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', verticalAlign: 'bottom',
  };

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
        <thead>
          {/* Dos filas de encabezado: la de arriba agrupa, la de abajo nombra. Es lo que
              permite que "Δ $" y "Δ p.p." se lean como una sola cosa —la variación— en vez
              de como dos columnas sueltas más. */}
          <tr style={{ background: '#fafaf9' }}>
            <th style={{ ...thBase, textAlign: 'left', color: '#6b7280' }} rowSpan={2}>Concepto</th>
            <th style={{ ...thBase, textAlign: 'right', color: '#374151' }} rowSpan={2}>{nombre}</th>
            <th style={{ ...thBase, textAlign: 'right', color: '#6b7280' }} rowSpan={2}>% ventas</th>
            <th style={{ ...thBase, textAlign: 'right', color: '#9ca3af' }} rowSpan={2}>{nombrePrev}</th>
            <th colSpan={2} style={{ ...thBase, ...BLOQUE_VAR, textAlign: 'center', color: '#374151', paddingBottom: '3px' }}>
              Variación vs {nombrePrev}
            </th>
            <th colSpan={2} style={{ ...thBase, ...BLOQUE_STOCK, textAlign: 'center', color: '#c3c2bd', fontWeight: 600, paddingBottom: '3px' }}>
              Movimiento de stock
            </th>
          </tr>
          <tr style={{ background: '#fafaf9' }}>
            <th style={{ ...thBase, ...BLOQUE_VAR, textAlign: 'right', color: '#6b7280', paddingTop: 0 }}>Δ $</th>
            <th style={{ ...thBase, background: BLOQUE_VAR.background, textAlign: 'right', color: '#6b7280', paddingTop: 0 }}>Δ p.p.</th>
            <th style={{ ...thBase, ...BLOQUE_STOCK, textAlign: 'right', color: '#c3c2bd', fontWeight: 600, paddingTop: 0 }}>Compró</th>
            <th style={{ ...thBase, textAlign: 'right', color: '#c3c2bd', fontWeight: 600, paddingTop: 0 }}>Δ stock</th>
          </tr>
        </thead>
        <tbody>
          {/* Ventas: acá el delta en puntos sobre sí mismas siempre daría cero, así que la
              columna de p.p. muestra cuánto cambió la venta en %. */}
          <tr style={{ borderTop: '1px solid #e5e7eb', background: 'rgba(17,24,39,0.028)' }}>
            <td style={{ ...cel, padding: '8px 10px' }}>
              <button onClick={() => toggle('ventas')}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#9ca3af', fontSize: '10px', width: '9px' }}>{abierto.ventas ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 800, fontSize: '12.5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Ventas</span>
              </button>
            </td>
            <td style={{ ...celNum, padding: '8px 10px', fontWeight: 800 }}>{$(act.ventas.total)}</td>
            <td style={{ ...celNum, padding: '8px 10px', fontSize: '12px', color: '#6b7280' }}>100,0%</td>
            <td style={{ ...celNum, padding: '8px 10px', fontSize: '12px', color: '#9ca3af' }}>{$(ant.ventas.total)}</td>
            <td style={{ ...celNum, ...BLOQUE_VAR, padding: '8px 10px', fontSize: '12px' }}>
              <DeltaMonto monto={act.ventas.total} anterior={ant.ventas.total} invertido fuerte />
            </td>
            <td style={{ ...celNum, background: BLOQUE_VAR.background, padding: '8px 10px', fontSize: '12px' }}>
              {varVentas === null ? <span style={{ color: '#d1d5db' }}>—</span> : (
                <span style={{ fontWeight: 700, color: Math.abs(varVentas) < 1 ? COLOR.neutro : varVentas > 0 ? COLOR.bueno : COLOR.malo }}>
                  {varVentas > 0 ? '↑' : varVentas < 0 ? '↓' : '·'} {Math.abs(Math.round(varVentas))}%
                </span>
              )}
            </td>
            {/* Ventas no sale de stock: las dos celdas van vacías, no corridas. */}
            <td style={{ ...celNum, ...BLOQUE_STOCK }} /><td style={celNum} />
          </tr>
          {abierto.ventas && act.ventas.porCultivo.map((c) => (
            <Fila key={c.label} label={c.label} monto={c.monto} anterior={montoAnt(c.label, ant.ventas.porCultivo)}
              nivel="detalle" invertido cantidad={`${Math.round(c.unidades).toLocaleString('es-AR')} u`} />
          ))}

          <Fila label="Costo variable" monto={act.costoVariable.total} anterior={ant.costoVariable.total} nivel="total" seccion="variable"
            compras={act.costoVariable.lineas.reduce((a, l) => a + (l.compras || 0), 0)}
            variacionStock={act.costoVariable.lineas.reduce((a, l) => a + (l.variacionStock || 0), 0)} />
          {abierto.variable && act.costoVariable.lineas.flatMap((l) => [
            <Fila key={l.label} label={l.label} monto={l.monto} anterior={montoAnt(l.label, ant.costoVariable.lineas)} nivel="detalle"
              compras={l.compras} variacionStock={l.variacionStock} />,
            <DetalleDe key={l.label + '-d'} label={l.label} />,
          ])}

          <Fila label="Costos fijos" monto={act.costosFijos.total} anterior={ant.costosFijos.total} nivel="total" seccion="fijos" />
          {abierto.fijos && act.costosFijos.lineas.flatMap((l) => [
            <Fila key={l.label} label={l.label} monto={l.monto} anterior={montoAnt(l.label, ant.costosFijos.lineas)} nivel="detalle" />,
            <DetalleDe key={l.label + '-d'} label={l.label} />,
          ])}

          <Fila label="Resultado final" monto={act.resultado} anterior={ant.resultado} nivel="resultado" invertido primerResultado />
          <Fila label="Resultado sin inversión" monto={act.resultadoSinInversion} anterior={ant.resultadoSinInversion} nivel="resultado" invertido />
        </tbody>
      </table>
      {desglose && (desglose.porArticulo.length > 0 || desglose.porCliente.length > 0) && (
        <div style={{ borderTop: '1px solid #f3f4f6', padding: '8px 10px', display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
          {([['Ventas por artículo', desglose.porArticulo], ['Ventas por cliente', desglose.porCliente]] as const).map(([titulo, filas]) => (
            filas.length === 0 ? null : (
              <details key={titulo} style={{ flex: '1 1 280px', minWidth: '240px' }}>
                <summary style={{ cursor: 'pointer', fontSize: '11.5px', fontWeight: 700, color: '#374151', listStyle: 'revert' }}>
                  {titulo} <span style={{ fontWeight: 400, color: '#9ca3af' }}>({filas.length})</span>
                </summary>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', marginTop: '5px' }}>
                  <tbody>
                    {filas.map((f) => (
                      <tr key={f.label} style={{ borderTop: '1px solid #f6f6f4' }}>
                        <td style={{ padding: '3px 6px 3px 0' }}>{f.label}</td>
                        <td style={{ padding: '3px 6px 3px 0', textAlign: 'right', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                          {Math.round(f.unidades).toLocaleString('es-AR')} u
                        </td>
                        <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {$(f.monto)}
                        </td>
                        <td style={{ padding: '3px 0 3px 8px', textAlign: 'right', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                          {act.ventas.total > 0 ? `${Math.round((f.monto / act.ventas.total) * 100)}%` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )
          ))}
        </div>
      )}

      <p style={{ margin: 0, padding: '9px 10px', fontSize: '11px', color: '#9ca3af', borderTop: '1px solid #f3f4f6', lineHeight: 1.6 }}>
        <strong>Δ $</strong> es cuánta plata más o menos que {nombrePrev}. <strong>Δ p.p.</strong> es cuánto cambió el
        <strong> peso sobre las ventas</strong>: si semillas pesaba 5% y ahora pesa 4%, dice ↓ 1,0 p.p. Las dos pueden ir
        para lados distintos —un costo puede salir más caro y a la vez pesar menos, si las ventas subieron más que él— y
        por eso están las dos. En Ventas la columna de p.p. muestra la variación en %, porque su peso sobre sí misma es
        siempre 100%.
        <br />
        El <strong>color marca lo que importa</strong>, no el signo: gris abajo de {UMBRAL_PP_CHICO.toFixed(1).replace('.', ',')} p.p.
        (o {(UMBRAL_$_CHICO * 100).toFixed(1).replace('.', ',')}% de las ventas del mes), naranja si empeoró algo moderado,
        rojo arriba de {UMBRAL_PP_GRANDE.toFixed(1).replace('.', ',')} p.p. (o {(UMBRAL_$_GRANDE * 100).toFixed(1).replace('.', ',')}% de las ventas),
        verde para cualquier mejora. Los umbrales son relativos a las ventas, así que siguen significando lo mismo cuando
        la facturación cambie.
        <br />
        <strong>Movimiento de stock</strong> explica de dónde sale el costo, no es el costo: <strong>Δ stock</strong> es
        cuánto subió o bajó el stock en el mes, y <em>compró − Δ stock = costo del mes</em>. Para ver cuánta plata hay
        parada en el depósito, que es otro número, está "Stock valorizado" en Stocks. El <strong>resultado sin inversión</strong> es
        el resultado devolviéndole lo gastado en equipamiento ({$(act.inversion)} este mes).
      </p>
    </div>
  );
}
