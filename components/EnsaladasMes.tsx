'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from 'recharts';
import type { PuntoEnsaladas, TipoEnsalada } from '@/lib/ensaladas';
import { resumenEnsaladas } from '@/lib/ensaladas';

// ── Ensaladas vendidas por mes ───────────────────────────────────────────────────────
//
// Lo pidió Fran: un solo número de cantidad vendida por mes, para poder presionar a
// Producción y a Ventas para que el producto fluya. Por eso el número del mes va grande y
// primero, y el gráfico abajo: lo que mueve a alguien es ver el número, no la serie.
//
// Partido por tipo porque "ensaladas" en general no dice si lo que no se mueve es la
// clásica o la de parmesano, y eso cambia a quién hay que ir a buscar.

const INK_SECUNDARIA = '#52514e';
const INK_MUTED = '#898781';
const GRID = '#e1e0d9';

const fmtEntero = (n: number) => Math.round(n || 0).toLocaleString('es-AR');

function TooltipEnsaladas({ active, payload, label, tipos }: any) {
  if (!active || !payload?.length) return null;
  const p: PuntoEnsaladas = payload[0]?.payload;
  if (!p) return null;
  return (
    <div style={{ background: 'white', border: '1px solid #e1e0d9', borderRadius: '8px', padding: '8px 11px', fontSize: '12px', boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700 }}>{label}</p>
      {tipos.map((t: TipoEnsalada) => (
        <p key={t.key} style={{ margin: 0, color: INK_SECUNDARIA }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: t.color, marginRight: '6px' }} />
          {t.label}: <strong>{fmtEntero(p.porTipo[t.key] || 0)}</strong>
        </p>
      ))}
      <p style={{ margin: '4px 0 0', paddingTop: '4px', borderTop: '1px solid #f3f4f6', fontWeight: 700 }}>
        Total: {fmtEntero(p.total)}
      </p>
      <p style={{ margin: 0, color: INK_MUTED, fontSize: '11px' }}>
        {p.clientes} cliente(s) compraron
      </p>
    </div>
  );
}

export default function EnsaladasMes({ datos, tipos, compacto = false }: {
  datos: PuntoEnsaladas[];
  tipos: TipoEnsalada[];
  // En el panel va sin el gráfico: ahí lo que importa es el número del mes.
  compacto?: boolean;
}) {
  const r = resumenEnsaladas(datos);
  if (!r.mesActual) return null;

  const sube = (r.diferencia ?? 0) > 0;
  const baja = (r.diferencia ?? 0) < 0;
  // El mes en curso todavía no terminó: compararlo con uno completo exagera la caída. Se
  // dice en vez de corregirlo con una proyección, que sería inventar la mitad del número.
  const esMesEnCurso = r.mesActual.mes === new Date().toISOString().slice(0, 7);

  return (
    <div className="card" style={{ margin: 0 }}>
      <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 700, color: '#115e59' }}>
        🥗 Ensaladas vendidas · {r.mesActual.label}
      </p>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', margin: '6px 0 2px' }}>
        <span style={{ fontSize: '32px', fontWeight: 800, lineHeight: 1, color: '#0f766e' }}>
          {fmtEntero(r.mesActual.total)}
        </span>
        {r.diferencia !== null && (
          <span style={{ fontSize: '13px', fontWeight: 700, color: sube ? '#166534' : baja ? '#b45309' : INK_MUTED }}>
            {sube ? '▲' : baja ? '▼' : '='} {fmtEntero(Math.abs(r.diferencia))}
            {r.variacionPct !== null ? ` (${r.variacionPct > 0 ? '+' : ''}${r.variacionPct}%)` : ''}
            <span style={{ fontWeight: 400, color: INK_MUTED }}> vs {r.mesAnterior?.label}</span>
          </span>
        )}
      </div>

      <p style={{ margin: '0 0 10px', fontSize: '11.5px', color: INK_MUTED, lineHeight: 1.5 }}>
        {tipos.map((t) => `${fmtEntero(r.mesActual!.porTipo[t.key] || 0)} ${t.label.toLowerCase()}`).join(' · ')}
        {r.mesActual.clientes > 0 && ` · ${r.mesActual.clientes} cliente(s)`}
        {esMesEnCurso && <span> · el mes todavía no terminó</span>}
        {r.mejor && r.mejor.mes !== r.mesActual.mes && (
          <> · mejor mes: <strong style={{ color: INK_SECUNDARIA }}>{fmtEntero(r.mejor.total)}</strong> en {r.mejor.label}</>
        )}
      </p>

      {!compacto && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={datos} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: INK_MUTED }} axisLine={false} tickLine={false} width={36} />
            <Tooltip content={<TooltipEnsaladas tipos={tipos} />} />
            <Legend wrapperStyle={{ fontSize: '12px', color: INK_SECUNDARIA }} />
            {tipos.map((t, i) => (
              <Bar key={t.key} dataKey={`porTipo.${t.key}`} name={t.label} stackId="e" fill={t.color} radius={i === tipos.length - 1 ? [4, 4, 0, 0] : undefined}>
                {/* El total arriba de la barra: la serie se lee de un vistazo sin pasar el
                    mouse, que es como se mira un número que se usa para presionar. */}
                {i === tipos.length - 1 && (
                  <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: INK_SECUNDARIA, fontWeight: 700 }} formatter={(v: any) => (Number(v) > 0 ? fmtEntero(Number(v)) : '')} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
