'use client';
import { useState } from 'react';

export interface DiaOcupacion {
  fecha: string;
  loteId: string | null;
  cultivo: 'lechuga' | 'rucula' | 'albahaca' | null;
  pct: number; // 0-100
}

export interface MesadaOcupacion {
  nombre: string;
  nave: number;
  dias: DiaOcupacion[];
}

const NAVE_COLOR: Record<number, string> = { 1: '#881337', 2: '#7c3aed' };
const CULTIVO_COLOR: Record<string, string> = {
  lechuga: '#16a34a',
  rucula: '#ea580c',
  albahaca: '#7c3aed',
};

function BarMesada({
  mesada, fechas, color,
}: {
  mesada: MesadaOcupacion;
  fechas: string[];
  color: string;
}) {
  const [hoverI, setHoverI] = useState<number | null>(null);

  const W = 700, H = 80;
  const PAD = { top: 6, right: 8, bottom: 18, left: 38 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;
  const baseY = PAD.top + ch;

  const n = fechas.length;
  const barGap = cw / n;
  const barW = Math.max(1, barGap * 0.72);

  function bx(i: number) { return PAD.left + i * barGap + barGap / 2 - barW / 2; }
  function bh(pct: number) { return (pct / 100) * ch; }

  const xTicks = fechas.reduce<{ i: number; label: string; bold: boolean }[]>((acc, f, i) => {
    const d = new Date(f + 'T12:00:00');
    const esLunes = d.getDay() === 1;
    const esPrimero = d.getDate() === 1;
    if (esLunes || esPrimero || i === 0)
      acc.push({ i, label: `${d.getDate()}/${d.getMonth() + 1}`, bold: esPrimero });
    return acc;
  }, []);

  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
          onMouseLeave={() => setHoverI(null)}
          onMouseMove={ev => {
            const rect = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
            const relX = ((ev.clientX - rect.left) / rect.width) * W;
            const i = Math.round((relX - PAD.left) / barGap);
            if (i >= 0 && i < n) setHoverI(i);
          }}
        >
          {/* Eje base y tope */}
          <line x1={PAD.left} x2={PAD.left + cw} y1={baseY}   y2={baseY}   stroke="#e5e7eb" strokeWidth={1} />
          <line x1={PAD.left} x2={PAD.left + cw} y1={PAD.top} y2={PAD.top} stroke="#f3f4f6" strokeWidth={1} strokeDasharray="3 3" />
          <text x={PAD.left - 4} y={baseY + 3}   textAnchor="end" fontSize={8} fill="#9ca3af">0%</text>
          <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fontSize={8} fill="#9ca3af">100%</text>

          {/* Ticks X */}
          {xTicks.map(({ i, label, bold }) => (
            <g key={i}>
              <line x1={PAD.left + i * barGap + barGap / 2} x2={PAD.left + i * barGap + barGap / 2}
                y1={PAD.top} y2={baseY} stroke="#f3f4f6" strokeWidth={1} />
              <text x={PAD.left + i * barGap + barGap / 2} y={baseY + 10}
                textAnchor="middle" fontSize={bold ? 9 : 8}
                fontWeight={bold ? 700 : 400} fill={bold ? '#6b7280' : '#9ca3af'}>
                {label}
              </text>
            </g>
          ))}

          {/* Barras */}
          {fechas.map((fecha, i) => {
            const pct = mesada.dias[i]?.pct ?? 0;
            const h = bh(pct);
            return h > 0 ? (
              <rect key={fecha} x={bx(i)} y={baseY - h} width={barW} height={h}
                fill={color} opacity={hoverI === i ? 1 : 0.75} rx={1} />
            ) : null;
          })}

          {/* Línea hover */}
          {hoverI !== null && (
            <line x1={PAD.left + hoverI * barGap + barGap / 2} x2={PAD.left + hoverI * barGap + barGap / 2}
              y1={PAD.top} y2={baseY} stroke="#6b7280" strokeWidth={1} strokeDasharray="2 2" />
          )}
        </svg>

        {/* Tooltip */}
        {hoverI !== null && (() => {
          const pct = mesada.dias[hoverI]?.pct ?? 0;
          const xPct = ((PAD.left + hoverI * barGap + barGap / 2) / W) * 100;
          return (
            <div style={{
              position: 'absolute', top: 0,
              left: `${xPct}%`,
              transform: xPct > 60 ? 'translateX(-108%)' : 'translateX(6px)',
              background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px',
              padding: '5px 9px', fontSize: '11px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
            }}>
              <span style={{ fontWeight: 700, color: '#374151' }}>{fechas[hoverI]}</span>
              <span style={{ color: pct > 0 ? color : '#9ca3af', fontWeight: 600, marginLeft: 8 }}>
                {pct > 0 ? `${pct}%` : '○ libre'}
              </span>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function SeccionTipo({
  titulo, mesadas, fechas, color,
}: {
  titulo: string;
  mesadas: MesadaOcupacion[];
  fechas: string[];
  color: string;
}) {
  if (!mesadas.length) return null;
  return (
    <div style={{ marginBottom: '14px' }}>
      <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {titulo}
      </p>
      {mesadas.map(m => (
        <div key={m.nombre} style={{ marginBottom: '4px' }}>
          <p style={{ margin: '0 0 2px', fontSize: '10px', color: '#6b7280', paddingLeft: '38px' }}>
            {m.nombre}
          </p>
          <BarMesada mesada={m} fechas={fechas} color={color} />
        </div>
      ))}
    </div>
  );
}

export default function GraficoOcupacionHistorial({
  mesadas, fechas, nave,
}: {
  mesadas: MesadaOcupacion[];
  fechas: string[];
  nave: 1 | 2;
}) {
  const filas = mesadas.filter(m => m.nave === nave);
  if (!filas.length) return (
    <p style={{ color: '#9ca3af', fontSize: '13px', padding: '8px 0' }}>Sin mesadas activas en Nave {nave}.</p>
  );

  const esTipo = (m: MesadaOcupacion, tipo: string) => {
    const n = m.nombre.toLowerCase();
    if (tipo === 'lechuga') return n.includes('lechuga');
    if (tipo === 'rucula')  return n.includes('rucula') || n.includes('rúcula');
    return n.includes('albahaca');
  };

  const lechuga = filas.filter(m => esTipo(m, 'lechuga'));
  const rucula  = filas.filter(m => esTipo(m, 'rucula'));
  const otras   = filas.filter(m => !esTipo(m, 'lechuga') && !esTipo(m, 'rucula'));

  return (
    <div>
      <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: 700, color: NAVE_COLOR[nave], textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Nave {nave}
      </p>
      <SeccionTipo titulo="Lechuga" mesadas={lechuga} fechas={fechas} color={CULTIVO_COLOR.lechuga} />
      <SeccionTipo titulo="Rúcula"  mesadas={rucula}  fechas={fechas} color={CULTIVO_COLOR.rucula} />
      <SeccionTipo titulo="Otras"   mesadas={otras}   fechas={fechas} color={NAVE_COLOR[nave]} />
    </div>
  );
}
