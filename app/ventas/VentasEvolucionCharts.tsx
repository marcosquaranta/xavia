'use client';
import { useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Line, LineChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';
import type { PuntoArticulo, EvolucionClientes, PuntoPrecio, ResumenMesActual, ClientePrecioVolumen } from '@/lib/estadisticasVentas';
import GraficoValorComercial from './GraficoValorComercial';

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
        {abierta ? '▾ Ocultar referencias y tabla' : '▸ Ver referencias y tabla de datos'}
      </button>
      {abierta && <div style={{ overflowX: 'auto', marginTop: '8px' }}>{children()}</div>}
    </div>
  );
}

const cardStyle: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' };
const titleStyle: React.CSSProperties = { margin: '0 0 12px', fontSize: '13px', fontWeight: 700, color: '#111827' };

// Encima de la barra apilada de lo YA vendido, si el mes está en curso, va el faltante
// hasta la proyección de fin de mes: mismo color de cada producto pero sin relleno (solo
// contorno punteado), para que se lea como "esto todavía no pasó, es una estimación".
const labelProyeccion = ({ x, y, width, payload }: any) => {
  const totalProy = (payload.proyRucula || 0) + (payload.proyLechuga || 0) + (payload.proyAlbahaca || 0);
  if (totalProy <= 0) return null;
  const totalEstimado = payload.rucula + payload.lechuga + payload.albahaca + totalProy;
  return <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill={INK_SECUNDARIA}>≈{fmtEntero(totalEstimado)}</text>;
};

export function GraficoVentaPorArticulo({ datos }: { datos: PuntoArticulo[] }) {
  return (
    <div style={cardStyle}>
      <p style={titleStyle}>Evolución de venta por artículo <span style={{ fontWeight: 400, color: '#9ca3af' }}>· el contorno punteado del mes en curso es la proyección a fin de mes</span></p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={datos} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={false} tickLine={false} tickFormatter={fmtMiles} width={36} />
          <Tooltip content={<TooltipCard formatter={fmtEntero} />} />
          <Legend wrapperStyle={{ fontSize: '12px', color: INK_SECUNDARIA }} iconType="circle" iconSize={8} />
          <Bar dataKey="rucula" name="Rúcula (paq.)" stackId="a" fill={CATEGORICOS[0]} stroke="#fff" strokeWidth={2}>
            <LabelList dataKey="rucula" position="inside" fill="#fff" fontSize={10} fontWeight={700} formatter={(v: number) => v > 0 ? fmtEntero(v) : ''} />
          </Bar>
          <Bar dataKey="proyRucula" stackId="a" fill={CATEGORICOS[0]} fillOpacity={0.12} stroke={CATEGORICOS[0]} strokeWidth={1.5} strokeDasharray="3 3" legendType="none" />
          <Bar dataKey="lechuga" name="Lechuga (pl.)" stackId="a" fill={CATEGORICOS[1]} stroke="#fff" strokeWidth={2}>
            <LabelList dataKey="lechuga" position="inside" fill="#fff" fontSize={10} fontWeight={700} formatter={(v: number) => v > 0 ? fmtEntero(v) : ''} />
          </Bar>
          <Bar dataKey="proyLechuga" stackId="a" fill={CATEGORICOS[1]} fillOpacity={0.12} stroke={CATEGORICOS[1]} strokeWidth={1.5} strokeDasharray="3 3" legendType="none" />
          <Bar dataKey="albahaca" name="Albahaca (pl.)" stackId="a" fill={CATEGORICOS[2]} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="albahaca" position="inside" fill="#111827" fontSize={10} fontWeight={700} formatter={(v: number) => v > 0 ? fmtEntero(v) : ''} />
          </Bar>
          <Bar dataKey="proyAlbahaca" stackId="a" fill={CATEGORICOS[2]} fillOpacity={0.12} stroke={CATEGORICOS[2]} strokeWidth={1.5} strokeDasharray="3 3" legendType="none" radius={[4, 4, 0, 0]}>
            <LabelList content={labelProyeccion} />
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
        <GraficoValorComercial datos={clientesPrecioVolumen} />
        <GraficoPrecioPromedio datos={precio} />
      </div>
    </div>
  );
}
