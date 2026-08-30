'use client';
import { useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Line, LineChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LabelList, ScatterChart, Scatter, Cell, ReferenceLine,
} from 'recharts';
import type { PuntoArticulo, EvolucionClientes, PuntoPrecio, ResumenMesActual, ClientePrecioVolumen } from '@/lib/estadisticasVentas';

// Paleta categórica (orden fijo, validada — ver skill de dataviz). Los slots aqua/
// amarillo/magenta quedan bajo 3:1 de contraste sobre blanco, por eso cada gráfico
// con esos colores tiene su tabla de datos como respaldo (relief rule).
const CATEGORICOS = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const INK_SECUNDARIA = '#52514e';
const INK_MUTED = '#898781';
const GRID = '#e1e0d9';

const fmtMiles = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
const fmtEntero = (n: number) => Math.round(n).toLocaleString('es-AR');
const fmtMoneda = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

function TooltipCard({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#111827' }}>{label}</p>
      {payload.filter((p: any) => p.value !== undefined).map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', color: INK_SECUNDARIA }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.color, display: 'inline-block' }} />
            {p.name}
          </span>
          <strong style={{ color: '#111827' }}>{formatter ? formatter(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

function TablaToggle({ children }: { children: () => React.ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <div style={{ marginTop: '8px' }}>
      <button onClick={() => setAbierta((v) => !v)} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '11px', cursor: 'pointer', padding: 0 }}>
        {abierta ? '▾ Ocultar tabla de datos' : '▸ Ver tabla de datos'}
      </button>
      {abierta && <div style={{ overflowX: 'auto', marginTop: '8px' }}>{children()}</div>}
    </div>
  );
}

const cardStyle: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' };
const titleStyle: React.CSSProperties = { margin: '0 0 12px', fontSize: '13px', fontWeight: 700, color: '#111827' };

export function GraficoVentaPorArticulo({ datos }: { datos: PuntoArticulo[] }) {
  return (
    <div style={cardStyle}>
      <p style={titleStyle}>Evolución de venta por artículo</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={datos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={false} tickLine={false} tickFormatter={fmtMiles} width={36} />
          <Tooltip content={<TooltipCard formatter={fmtEntero} />} />
          <Legend wrapperStyle={{ fontSize: '12px', color: INK_SECUNDARIA }} iconType="circle" iconSize={8} />
          <Bar dataKey="rucula" name="Rúcula (paq.)" stackId="a" fill={CATEGORICOS[0]} stroke="#fff" strokeWidth={2}>
            <LabelList dataKey="rucula" position="inside" fill="#fff" fontSize={10} fontWeight={700} formatter={(v: number) => v > 0 ? fmtEntero(v) : ''} />
          </Bar>
          <Bar dataKey="lechuga" name="Lechuga (pl.)" stackId="a" fill={CATEGORICOS[1]} stroke="#fff" strokeWidth={2}>
            <LabelList dataKey="lechuga" position="inside" fill="#fff" fontSize={10} fontWeight={700} formatter={(v: number) => v > 0 ? fmtEntero(v) : ''} />
          </Bar>
          <Bar dataKey="albahaca" name="Albahaca (pl.)" stackId="a" fill={CATEGORICOS[2]} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="albahaca" position="inside" fill="#111827" fontSize={10} fontWeight={700} formatter={(v: number) => v > 0 ? fmtEntero(v) : ''} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <TablaToggle>
        {() => (
          <table style={{ fontSize: '12px', width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Mes</th><th style={{ textAlign: 'right' }}>Rúcula</th><th style={{ textAlign: 'right' }}>Lechuga</th><th style={{ textAlign: 'right' }}>Albahaca</th></tr></thead>
            <tbody>{datos.map((d) => (
              <tr key={d.mes}><td>{d.label}</td><td style={{ textAlign: 'right' }}>{fmtEntero(d.rucula)}</td><td style={{ textAlign: 'right' }}>{fmtEntero(d.lechuga)}</td><td style={{ textAlign: 'right' }}>{fmtEntero(d.albahaca)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </TablaToggle>
    </div>
  );
}

export function GraficoVentaPorCliente({ semanal, mensual, ocultarToggle = false }: { semanal?: EvolucionClientes; mensual: EvolucionClientes; ocultarToggle?: boolean }) {
  const [modo, setModo] = useState<'semana' | 'mes'>(ocultarToggle ? 'mes' : 'semana');
  const datos = modo === 'semana' ? (semanal ?? mensual) : mensual;
  const data = datos.meses.map((m, i) => ({ label: m.label, ...datos.puntos[i] }));
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <p style={{ ...titleStyle, margin: 0 }}>Evolución de venta por cliente <span style={{ fontWeight: 400, color: '#9ca3af' }}>· top {datos.series.length} · unidades totales{ocultarToggle ? ' · por mes' : ''}</span></p>
        {!ocultarToggle && (
          <div style={{ display: 'flex', gap: '4px' }}>
            {([['semana', 'Por semana'], ['mes', 'Por mes']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setModo(v)}
                style={{ padding: '3px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: modo === v ? 700 : 400, background: modo === v ? '#111827' : '#f3f4f6', color: modo === v ? 'white' : '#6b7280', border: 'none', cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={false} tickLine={false} tickFormatter={fmtMiles} width={36} />
          <Tooltip content={<TooltipCard formatter={fmtEntero} />} />
          <Legend wrapperStyle={{ fontSize: '12px', color: INK_SECUNDARIA }} iconType="circle" iconSize={8} />
          {datos.series.map((s, i) => (
            <Line key={s.id_control} type="monotone" dataKey={s.id_control} name={s.nombre}
              stroke={CATEGORICOS[i % CATEGORICOS.length]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <TablaToggle>
        {() => (
          <table style={{ fontSize: '12px', width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>{modo === 'semana' ? 'Semana' : 'Mes'}</th>{datos.series.map((s) => <th key={s.id_control} style={{ textAlign: 'right' }}>{s.nombre}</th>)}</tr></thead>
            <tbody>{datos.meses.map((m, i) => (
              <tr key={m.mes}><td>{m.label}</td>{datos.series.map((s) => <td key={s.id_control} style={{ textAlign: 'right' }}>{fmtEntero(datos.puntos[i][s.id_control] || 0)}</td>)}</tr>
            ))}</tbody>
          </table>
        )}
      </TablaToggle>
    </div>
  );
}

export function GraficoPrecioPromedio({ datos }: { datos: PuntoPrecio[] }) {
  const finalLabel = (dataKey: string) => ({ x, y, value, index }: any) =>
    index === datos.length - 1
      ? <text x={x} y={y - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="#111827">{fmtMoneda(value as number)}</text>
      : null;
  return (
    <div style={cardStyle}>
      <p style={titleStyle}>Evolución del precio promedio <span style={{ fontWeight: 400, color: '#9ca3af' }}>· $ ARS final (IVA incluido), ponderado por unidades</span></p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={datos} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
          {/* allowDataOverflow: SIN esto, Recharts ignora el domain fijo apenas algún punto
              queda afuera del rango — lo re-escala solo para que entre igual. Con esto el
              eje queda fijo de verdad en [1500, 2000], recorta lo que se pase (no hay
              puntos fuera de ese rango en la práctica, pero si algún día lo hay, mejor que
              se vea "pegado al techo/piso" a que el eje entero se descuadre). */}
          <YAxis tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={false} tickLine={false} tickFormatter={fmtMoneda} width={56} domain={[1500, 2000]} allowDataOverflow />
          <Tooltip content={<TooltipCard formatter={fmtMoneda} />} />
          <Legend wrapperStyle={{ fontSize: '12px', color: INK_SECUNDARIA }} iconType="circle" iconSize={8} />
          <Line type="monotone" dataKey="precioRucula" name="Rúcula" stroke={CATEGORICOS[0]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }}>
            <LabelList dataKey="precioRucula" position="top" content={finalLabel('precioRucula')} />
          </Line>
          <Line type="monotone" dataKey="precioLechuga" name="Lechuga" stroke={CATEGORICOS[1]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }}>
            <LabelList dataKey="precioLechuga" position="top" content={finalLabel('precioLechuga')} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
      <TablaToggle>
        {() => (
          <table style={{ fontSize: '12px', width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Mes</th><th style={{ textAlign: 'right' }}>Rúcula</th><th style={{ textAlign: 'right' }}>Lechuga</th></tr></thead>
            <tbody>{datos.map((d) => <tr key={d.mes}><td>{d.label}</td><td style={{ textAlign: 'right' }}>{fmtMoneda(d.precioRucula)}</td><td style={{ textAlign: 'right' }}>{fmtMoneda(d.precioLechuga)}</td></tr>)}</tbody>
          </table>
        )}
      </TablaToggle>
    </div>
  );
}

export function TarjetaIndicadores({ datos }: { datos: ResumenMesActual }) {
  const items = [
    { label: 'Unidades vendidas este mes', valor: fmtEntero(datos.unidadesMes) },
    { label: 'Proyección del mes', valor: fmtEntero(datos.proyeccionMes) },
    { label: 'Precio promedio', valor: fmtMoneda(datos.precioPromedioMes) },
  ];
  return (
    <div style={{ ...cardStyle, padding: '12px 16px' }}>
      <p style={{ ...titleStyle, marginBottom: '10px' }}>Indicadores <span style={{ fontWeight: 400, color: '#9ca3af' }}>· mes en curso</span></p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px' }}>
        {items.map((it) => (
          <div key={it.label}>
            <p style={{ margin: '0 0 2px', fontSize: '11px', color: INK_SECUNDARIA, lineHeight: 1.3 }}>{it.label}</p>
            <strong style={{ fontSize: '22px', color: '#111827', lineHeight: 1 }}>{it.valor}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Clientes: precio promedio (X) vs. volumen del mes (Y) ────────────────────
// Cada punto es un cliente. Lo que se busca leer es el CUADRANTE, no el punto exacto:
// arriba a la izquierda (mucho volumen a precio bajo) es donde más plata se deja sobre la
// mesa, y es justo lo que una tabla ordenada por volumen no deja ver.
//
// El color va por precio contra el promedio general PONDERADO por volumen: verde el que
// paga por encima, rojo el que paga por debajo, amarillo el que está en el promedio. El
// umbral es relativo (±5%), así se recalibra solo cuando cambian los precios de lista.
const COLOR_BUENO = '#008300', COLOR_MEDIO = '#eda100', COLOR_MALO = '#e34948';
// El eje X arranca en $1.300 en vez de en 0: dejarlo en 0 comprime a todos los clientes
// contra el borde derecho y no se distingue uno de otro. PERO nunca se recorta un cliente
// para lograrlo — si alguno paga menos de eso, el eje baja hasta incluirlo. Un cliente que
// paga poco es justamente el que hay que ver, no el que conviene esconder.
const X_MINIMO_PREFERIDO = 1300;

// El eje Y con un decimal: con "k" redondeado a entero, 2.100 y 2.400 se leían los dos
// "2k" y no se distinguía un cliente de otro.
const fmtMilesDecimal = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));

// El color sale del CRUCE de las dos variables, no del precio solo: un cliente que paga
// bien pero compra poco no es lo mismo que uno que paga bien y se lleva medio galpón.
// "Mucho / poco" es siempre RELATIVO al resto de los clientes del mes — se parte por la
// mediana de cada eje, que no se deja arrastrar por un cliente enorme o carísimo como sí
// haría el promedio.
//
//   verde    mucho volumen + buen precio      (los que hay que cuidar)
//   amarillo mucho volumen + precio regular, o buen precio + poco volumen
//   rojo     poco volumen + precio bajo       (los que menos aportan)
function medianaDe(valores: number[]): number {
  if (!valores.length) return 0;
  const o = [...valores].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

export function GraficoClientesPrecioVolumen({ datos, titulo = 'Clientes — precio vs. volumen' }: {
  datos: ClientePrecioVolumen[]; titulo?: string;
}) {
  if (!datos.length) {
    return (
      <div style={cardStyle}>
        <p style={titleStyle}>{titulo}</p>
        <p style={{ color: INK_MUTED, fontSize: '12px', textAlign: 'center', padding: '40px 0' }}>Sin ventas cargadas en los últimos 30 días.</p>
      </div>
    );
  }
  // Corte por MEDIANA de cada eje: divide a los clientes en mitades sin que un cliente
  // gigante (o uno que paga carísimo) corra el umbral para todos los demás.
  const medPrecio = medianaDe(datos.map((d) => d.precioPromedio));
  const medVolumen = medianaDe(datos.map((d) => d.unidades));
  const colorDe = (d: ClientePrecioVolumen) => {
    const buenPrecio = d.precioPromedio >= medPrecio;
    const muchoVolumen = d.unidades >= medVolumen;
    if (buenPrecio && muchoVolumen) return COLOR_BUENO;
    if (buenPrecio || muchoVolumen) return COLOR_MEDIO;
    return COLOR_MALO;
  };
  const puntos = datos.map((d) => ({ ...d, color: colorDe(d) }));
  const leyenda = [
    { color: COLOR_BUENO, texto: 'Mucho volumen y buen precio' },
    { color: COLOR_MEDIO, texto: 'Mucho volumen o buen precio' },
    { color: COLOR_MALO, texto: 'Poco volumen y precio bajo' },
  ];
  // Extremos del eje X, con aire a los costados para que las etiquetas no se corten.
  const minPrecio = Math.min(...datos.map((d) => d.precioPromedio));
  const maxPrecio = Math.max(...datos.map((d) => d.precioPromedio));
  const xMin = minPrecio >= X_MINIMO_PREFERIDO ? X_MINIMO_PREFERIDO : Math.floor((minPrecio * 0.92) / 100) * 100;
  const xMax = Math.ceil((maxPrecio * 1.12) / 100) * 100;

  // Etiqueta con el nombre del cliente al lado de cada punto. Nombres largos cortados,
  // que si no se pisan entre ellos y tapan el gráfico.
  const EtiquetaNombre = (props: any) => {
    const { x, y, index } = props;
    const d = puntos[index];
    if (!d || x === undefined || y === undefined) return null;
    const corto = d.nombre.length > 16 ? d.nombre.slice(0, 15) + '…' : d.nombre;
    return (
      <text x={x} y={y - 11} textAnchor="middle" fontSize={10} fill={INK_SECUNDARIA} fontWeight={600}>
        {corto}
      </text>
    );
  };

  return (
    <div style={cardStyle}>
      <p style={titleStyle}>{titulo} <span style={{ fontWeight: 400, color: '#9ca3af' }}>· últimos 30 días</span></p>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 18, bottom: 26, left: 10 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis type="number" dataKey="precioPromedio" name="Precio promedio"
            domain={[xMin, xMax]}
            tickFormatter={(v) => fmtMoneda(v)} tick={{ fontSize: 11, fill: INK_SECUNDARIA }}
            label={{ value: 'Precio promedio por unidad', position: 'insideBottom', offset: -16, fontSize: 11, fill: INK_MUTED }} />
          <YAxis type="number" dataKey="unidades" name="Unidades"
            tickFormatter={fmtMilesDecimal} tick={{ fontSize: 11, fill: INK_SECUNDARIA }}
            label={{ value: 'Unidades (30 días)', angle: -90, position: 'insideLeft', fontSize: 11, fill: INK_MUTED }} />
          <ReferenceLine x={medPrecio} stroke={INK_MUTED} strokeDasharray="4 4" />
          <ReferenceLine y={medVolumen} stroke={INK_MUTED} strokeDasharray="4 4" />
          <Tooltip content={<TooltipScatter />} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={puntos} shape="circle">
            {puntos.map((p) => <Cell key={p.id_control} fill={p.color} r={9} />)}
            <LabelList content={EtiquetaNombre} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '11px', color: INK_SECUNDARIA, marginTop: '4px' }}>
        {leyenda.map((l) => (
          <span key={l.texto} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: l.color, display: 'inline-block' }} />{l.texto}
          </span>
        ))}
        <span style={{ color: INK_MUTED }}>líneas punteadas = la mitad de los clientes de cada lado ({fmtMoneda(medPrecio)} · {fmtEntero(medVolumen)} u)</span>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: INK_MUTED, lineHeight: 1.5 }}>
        Ventana móvil de 30 días: un cliente que hace más de un mes que no compra no aparece. El color compara
        a cada cliente contra el resto: las líneas punteadas parten a los clientes por la mitad en cada eje.
        Arriba a la izquierda (mucho volumen a precio bajo) es donde más conviene mirar. El precio promedio se
        calcula solo sobre paquete/planta: mezclar bandeja y kg da un número que no se puede comparar entre
        clientes.
      </p>

      <TablaToggle>
        {() => (
          <table style={{ fontSize: '11px', width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: INK_MUTED }}>
              <th style={{ textAlign: 'left', padding: '3px 6px 3px 0' }}>Cliente</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Precio prom.</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Unidades (30d)</th>
              <th style={{ textAlign: 'right', padding: '3px 0' }}>Facturado</th>
            </tr></thead>
            <tbody>
              {puntos.map((p) => (
                <tr key={p.id_control} style={{ borderTop: '1px solid #f1f0eb' }}>
                  <td style={{ padding: '3px 6px 3px 0' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block', marginRight: 5 }} />
                    {p.nombre}
                  </td>
                  <td style={{ textAlign: 'right', padding: '3px 6px' }}>{fmtMoneda(p.precioPromedio)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 6px' }}>{fmtEntero(p.unidades)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 0' }}>{fmtMoneda(p.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TablaToggle>
    </div>
  );
}

function TooltipScatter({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#111827' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, display: 'inline-block', marginRight: 5 }} />
        {d.nombre}
      </p>
      <div style={{ color: INK_SECUNDARIA }}>Precio promedio: <strong style={{ color: '#111827' }}>{fmtMoneda(d.precioPromedio)}</strong></div>
      <div style={{ color: INK_SECUNDARIA }}>Unidades (30 días): <strong style={{ color: '#111827' }}>{fmtEntero(d.unidades)}</strong></div>
      <div style={{ color: INK_SECUNDARIA }}>Facturado: <strong style={{ color: '#111827' }}>{fmtMoneda(d.monto)}</strong></div>
    </div>
  );
}

export default function VentasEvolucionCharts({ articulo, clienteSemanal, clienteMensual, precio, resumenMes, clientesPrecioVolumen }: {
  articulo: PuntoArticulo[]; clienteSemanal: EvolucionClientes; clienteMensual: EvolucionClientes; precio: PuntoPrecio[]; resumenMes: ResumenMesActual;
  clientesPrecioVolumen: ClientePrecioVolumen[];
}) {
  if (!articulo.length && !clienteSemanal.meses.length && !precio.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: '14px' }}>
        <GraficoVentaPorArticulo datos={articulo} />
        <GraficoVentaPorCliente semanal={clienteSemanal} mensual={clienteMensual} />
      </div>
      <TarjetaIndicadores datos={resumenMes} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: '14px' }}>
        <GraficoPrecioPromedio datos={precio} />
        <GraficoClientesPrecioVolumen datos={clientesPrecioVolumen} />
      </div>
    </div>
  );
}
