'use client';
import { useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Line, LineChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';
import type { PuntoArticulo, EvolucionClientes, PuntoPrecio } from '@/lib/estadisticasVentas';

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
          <Bar dataKey="rucula" name="Rúcula (paq.)" stackId="a" fill={CATEGORICOS[0]} stroke="#fff" strokeWidth={2} />
          <Bar dataKey="lechuga" name="Lechuga (pl.)" stackId="a" fill={CATEGORICOS[1]} stroke="#fff" strokeWidth={2} />
          <Bar dataKey="albahaca" name="Albahaca (pl.)" stackId="a" fill={CATEGORICOS[2]} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} />
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

export function GraficoVentaPorCliente({ datos }: { datos: EvolucionClientes }) {
  const data = datos.meses.map((m, i) => ({ label: m.label, ...datos.puntos[i] }));
  return (
    <div style={cardStyle}>
      <p style={titleStyle}>Evolución de venta por cliente <span style={{ fontWeight: 400, color: '#9ca3af' }}>· top {datos.series.length} · unidades totales</span></p>
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
            <thead><tr><th style={{ textAlign: 'left' }}>Mes</th>{datos.series.map((s) => <th key={s.id_control} style={{ textAlign: 'right' }}>{s.nombre}</th>)}</tr></thead>
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
  const ultimo = datos[datos.length - 1];
  return (
    <div style={cardStyle}>
      <p style={titleStyle}>Evolución del precio promedio de venta <span style={{ fontWeight: 400, color: '#9ca3af' }}>· $ ARS, ponderado por unidades</span></p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={datos} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={false} tickLine={false} tickFormatter={fmtMoneda} width={56} domain={['dataMin - 100', 'dataMax + 100']} />
          <Tooltip content={<TooltipCard formatter={fmtMoneda} />} />
          <Line type="monotone" dataKey="precioPromedio" name="Precio promedio" stroke={CATEGORICOS[0]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }}>
            <LabelList dataKey="precioPromedio" position="top" content={({ x, y, value, index }: any) =>
              index === datos.length - 1
                ? <text x={x} y={y - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="#111827">{fmtMoneda(value as number)}</text>
                : null
            } />
          </Line>
        </LineChart>
      </ResponsiveContainer>
      <TablaToggle>
        {() => (
          <table style={{ fontSize: '12px', width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Mes</th><th style={{ textAlign: 'right' }}>Precio promedio</th></tr></thead>
            <tbody>{datos.map((d) => <tr key={d.mes}><td>{d.label}</td><td style={{ textAlign: 'right' }}>{fmtMoneda(d.precioPromedio)}</td></tr>)}</tbody>
          </table>
        )}
      </TablaToggle>
    </div>
  );
}

export default function VentasEvolucionCharts({ articulo, cliente, precio }: {
  articulo: PuntoArticulo[]; cliente: EvolucionClientes; precio: PuntoPrecio[];
}) {
  if (!articulo.length && !cliente.meses.length && !precio.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <GraficoVentaPorArticulo datos={articulo} />
        <GraficoVentaPorCliente datos={cliente} />
      </div>
      <GraficoPrecioPromedio datos={precio} />
    </div>
  );
}
