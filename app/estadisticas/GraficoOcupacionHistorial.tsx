'use client';
import { useState } from 'react';

export interface DiaOcupacion {
  fecha: string;
  loteId: string | null;
  cultivo: 'lechuga' | 'rucula' | 'albahaca' | null;
}

export interface MesadaOcupacion {
  nombre: string;
  nave: number;
  dias: DiaOcupacion[];
}

const COLOR = { lechuga: '#22c55e', rucula: '#f97316', albahaca: '#a855f7' };
const FILL  = { lechuga: '#bbf7d0', rucula: '#fed7aa', albahaca: '#e9d5ff' };
const LABEL = { lechuga: 'Lechuga', rucula: 'Rúcula', albahaca: 'Albahaca' };
const NAVE_COLOR: Record<number, string> = { 1: '#881337', 2: '#7c3aed' };
type Cultivo = 'lechuga' | 'rucula' | 'albahaca';

export default function GraficoOcupacionHistorial({
  mesadas, fechas, nave,
}: {
  mesadas: MesadaOcupacion[];
  fechas: string[];
  nave: 1 | 2;
}) {
  const filas = mesadas.filter(m => m.nave === nave);
  const total = filas.length;
  const [tooltip, setTooltip] = useState<{ x: number; y: number; i: number } | null>(null);

  if (!filas.length || !fechas.length) return (
    <p style={{ color: '#9ca3af', fontSize: '13px', padding: '8px 0' }}>Sin mesadas activas en Nave {nave}.</p>
  );

  // Para cada día, calcular % por cultivo
  type Punto = { fecha: string; lechuga: number; rucula: number; albahaca: number; total: number };
  const puntos: Punto[] = fechas.map((fecha, di) => {
    let lechuga = 0, rucula = 0, albahaca = 0;
    for (const m of filas) {
      const c = m.dias[di]?.cultivo;
      if (c === 'lechuga') lechuga++;
      else if (c === 'rucula') rucula++;
      else if (c === 'albahaca') albahaca++;
    }
    return {
      fecha,
      lechuga: Math.round((lechuga / total) * 100),
      rucula:  Math.round((rucula  / total) * 100),
      albahaca:Math.round((albahaca/ total) * 100),
      total:   Math.round(((lechuga + rucula + albahaca) / total) * 100),
    };
  });

  // SVG dims
  const W = 800, H = 200;
  const PAD = { top: 16, right: 16, bottom: 28, left: 36 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  function px(i: number) { return PAD.left + (i / (puntos.length - 1)) * cw; }
  function py(pct: number) { return PAD.top + ch - (pct / 100) * ch; }

  function areaPath(key: Cultivo) {
    if (!puntos.length) return '';
    const pts = puntos.map((p, i) => `${px(i)},${py(p[key])}`).join(' L ');
    const x0 = px(0), xN = px(puntos.length - 1), y0 = py(0);
    return `M ${x0},${y0} L ${pts} L ${xN},${y0} Z`;
  }

  function linePath(key: Cultivo | 'total') {
    if (!puntos.length) return '';
    return puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i)},${py(p[key])}`).join(' ');
  }

  // Ticks Y: 0, 25, 50, 75, 100
  const yTicks = [0, 25, 50, 75, 100];

  // Ticks X: lunes y día 1 de mes
  const xTicks = fechas.reduce<{ i: number; label: string }[]>((acc, f, i) => {
    const d = new Date(f + 'T12:00:00');
    const esLunes = d.getDay() === 1;
    const esPrimero = d.getDate() === 1;
    if (esLunes || esPrimero || i === 0) {
      acc.push({ i, label: `${d.getDate()}/${d.getMonth() + 1}` });
    }
    return acc;
  }, []);

  const tip = tooltip !== null ? puntos[tooltip.i] : null;

  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 700, color: NAVE_COLOR[nave], textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Nave {nave}
      </p>

      <div style={{ position: 'relative', width: '100%' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', display: 'block', overflow: 'visible' }}
          onMouseLeave={() => setTooltip(null)}
          onMouseMove={ev => {
            const rect = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
            const relX = ((ev.clientX - rect.left) / rect.width) * W;
            const i = Math.round(((relX - PAD.left) / cw) * (puntos.length - 1));
            if (i >= 0 && i < puntos.length) {
              setTooltip({ x: px(i), y: ev.clientY - rect.top, i });
            }
          }}
        >
          {/* Grid lines Y */}
          {yTicks.map(t => (
            <g key={t}>
              <line
                x1={PAD.left} x2={PAD.left + cw}
                y1={py(t)} y2={py(t)}
                stroke={t === 0 ? '#d1d5db' : '#f3f4f6'} strokeWidth={t === 0 ? 1 : 1}
                strokeDasharray={t > 0 ? '3 3' : undefined}
              />
              <text x={PAD.left - 4} y={py(t)} textAnchor="end" dominantBaseline="middle"
                fontSize={8} fill="#9ca3af">
                {t}%
              </text>
            </g>
          ))}

          {/* Grid lines X (lunes) */}
          {xTicks.map(({ i, label }) => (
            <g key={i}>
              <line x1={px(i)} x2={px(i)} y1={PAD.top} y2={PAD.top + ch}
                stroke="#f3f4f6" strokeWidth={1} />
              <text x={px(i)} y={PAD.top + ch + 10} textAnchor="middle" fontSize={8} fill="#9ca3af">
                {label}
              </text>
            </g>
          ))}

          {/* Áreas rellenas */}
          {(['lechuga', 'rucula', 'albahaca'] as Cultivo[]).map(k => (
            <path key={k} d={areaPath(k)} fill={FILL[k]} opacity={0.5} />
          ))}

          {/* Líneas */}
          {(['lechuga', 'rucula', 'albahaca'] as Cultivo[]).map(k => (
            <path key={k} d={linePath(k)} fill="none" stroke={COLOR[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {/* Línea total % ocupado */}
          <path d={linePath('total')} fill="none" stroke="#94a3b8" strokeWidth={1.5}
            strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />

          {/* Línea vertical del tooltip */}
          {tooltip && (
            <line x1={tooltip.x} x2={tooltip.x} y1={PAD.top} y2={PAD.top + ch}
              stroke="#6b7280" strokeWidth={1} strokeDasharray="2 2" />
          )}

          {/* Puntos tooltip */}
          {tooltip && tip && (['lechuga', 'rucula', 'albahaca'] as Cultivo[]).map(k => tip[k] > 0 && (
            <circle key={k} cx={tooltip.x} cy={py(tip[k])} r={3} fill={COLOR[k]} stroke="white" strokeWidth={1.5} />
          ))}
        </svg>

        {/* Tooltip flotante */}
        {tooltip && tip && (
          <div style={{
            position: 'absolute',
            left: `${(tooltip.x / W) * 100}%`,
            top: '0',
            transform: tooltip.x > W * 0.65 ? 'translateX(-110%)' : 'translateX(8px)',
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '7px',
            padding: '8px 10px',
            fontSize: '11px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}>
            <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#374151', fontSize: '10px' }}>{tip.fecha}</p>
            {(['lechuga', 'rucula', 'albahaca'] as Cultivo[]).map(k => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '5px', color: COLOR[k], marginBottom: '1px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLOR[k] }} />
                <span>{LABEL[k]}: <strong>{tip[k]}%</strong></span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '4px', paddingTop: '3px', color: '#6b7280' }}>
              Total ocupado: <strong>{tip.total}%</strong>
            </div>
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div style={{ display: 'flex', gap: '14px', marginTop: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
        {(['lechuga', 'rucula', 'albahaca'] as Cultivo[]).map(k => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '18px', height: '3px', background: COLOR[k], borderRadius: '2px' }} />
            <span style={{ fontSize: '10px', color: '#6b7280' }}>{LABEL[k]}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <svg width="18" height="3"><line x1="0" y1="1.5" x2="18" y2="1.5" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3"/></svg>
          <span style={{ fontSize: '10px', color: '#9ca3af' }}>Total</span>
        </div>
      </div>
    </div>
  );
}
