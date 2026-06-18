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

// Paleta de colores distinguibles para líneas individuales
const PALETA = [
  '#16a34a','#2563eb','#dc2626','#9333ea','#ca8a04','#0891b2',
  '#ea580c','#4f46e5','#be185d','#15803d','#1d4ed8','#b91c1c',
];

const NAVE_COLOR: Record<number, string> = { 1: '#881337', 2: '#7c3aed' };

type Cultivo = 'lechuga' | 'rucula' | 'albahaca';

function MiniChart({
  titulo, mesadas, fechas, colorNave,
}: {
  titulo: string;
  mesadas: MesadaOcupacion[];
  fechas: string[];
  colorNave: string;
}) {
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);

  if (!mesadas.length || !fechas.length) return null;

  const W = 700, H = 160;
  const PAD = { top: 14, right: 14, bottom: 28, left: 34 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;
  const baseY = PAD.top + ch;

  function px(i: number) { return PAD.left + (i / Math.max(fechas.length - 1, 1)) * cw; }
  function py(pct: number) { return baseY - (pct / 100) * ch; }

  // Ticks X: lunes y día 1
  const xTicks = fechas.reduce<{ i: number; label: string; bold: boolean }[]>((acc, f, i) => {
    const d = new Date(f + 'T12:00:00');
    const esLunes = d.getDay() === 1;
    const esPrimero = d.getDate() === 1;
    if (esLunes || esPrimero || i === 0)
      acc.push({ i, label: `${d.getDate()}/${d.getMonth() + 1}`, bold: esPrimero });
    return acc;
  }, []);

  // Para cada mesada: construir path tipo "step" (escalón)
  function stepPath(m: MesadaOcupacion): string {
    if (!m.dias.length) return '';
    const segs: string[] = [];
    for (let i = 0; i < m.dias.length; i++) {
      const occ = m.dias[i].cultivo !== null ? 100 : 0;
      const x = px(i);
      const y = py(occ);
      if (i === 0) segs.push(`M ${x} ${y}`);
      else {
        // Escalón horizontal desde el punto anterior hasta x actual, luego vertical
        const prevOcc = m.dias[i - 1].cultivo !== null ? 100 : 0;
        if (occ !== prevOcc) {
          segs.push(`H ${x}`);
          segs.push(`V ${y}`);
        } else {
          segs.push(`H ${x}`);
        }
      }
    }
    return segs.join(' ');
  }

  const hoverI = hover?.i ?? null;
  const hoverX = hoverI !== null ? px(hoverI) : null;

  return (
    <div style={{ marginBottom: '18px' }}>
      <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 700, color: colorNave, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {titulo}
      </p>
      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
          onMouseLeave={() => setHover(null)}
          onMouseMove={ev => {
            const rect = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
            const relX = ((ev.clientX - rect.left) / rect.width) * W;
            const i = Math.round(((relX - PAD.left) / cw) * (fechas.length - 1));
            if (i >= 0 && i < fechas.length) setHover({ x: px(i), i });
          }}
        >
          {/* Líneas Y: 0% y 100% */}
          <line x1={PAD.left} x2={PAD.left + cw} y1={py(0)}   y2={py(0)}   stroke="#e5e7eb" strokeWidth={1} />
          <line x1={PAD.left} x2={PAD.left + cw} y1={py(100)} y2={py(100)} stroke="#f3f4f6" strokeWidth={1} strokeDasharray="3 3" />
          <text x={PAD.left - 4} y={py(0)   + 4} textAnchor="end" fontSize={8} fill="#9ca3af">0%</text>
          <text x={PAD.left - 4} y={py(100) + 4} textAnchor="end" fontSize={8} fill="#9ca3af">100%</text>

          {/* Grid X */}
          {xTicks.map(({ i, label, bold }) => (
            <g key={i}>
              <line x1={px(i)} x2={px(i)} y1={PAD.top} y2={baseY} stroke="#f3f4f6" strokeWidth={1} />
              <text x={px(i)} y={baseY + 10} textAnchor="middle" fontSize={bold ? 9 : 8}
                fontWeight={bold ? 700 : 400} fill={bold ? '#6b7280' : '#9ca3af'}>
                {label}
              </text>
            </g>
          ))}

          {/* Líneas por mesada */}
          {mesadas.map((m, mi) => (
            <path
              key={m.nombre}
              d={stepPath(m)}
              fill="none"
              stroke={PALETA[mi % PALETA.length]}
              strokeWidth={2}
              strokeLinecap="square"
              opacity={0.85}
            />
          ))}

          {/* Línea vertical hover */}
          {hoverX !== null && (
            <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={baseY}
              stroke="#6b7280" strokeWidth={1} strokeDasharray="2 2" />
          )}

          {/* Puntos hover */}
          {hoverI !== null && mesadas.map((m, mi) => {
            const occ = m.dias[hoverI]?.cultivo !== null ? 100 : 0;
            return (
              <circle key={m.nombre} cx={px(hoverI)} cy={py(occ)} r={3}
                fill={PALETA[mi % PALETA.length]} stroke="white" strokeWidth={1.5} />
            );
          })}
        </svg>

        {/* Tooltip */}
        {hoverI !== null && hoverX !== null && (
          <div style={{
            position: 'absolute', top: 0,
            left: `${(hoverX / W) * 100}%`,
            transform: hoverX > W * 0.6 ? 'translateX(-108%)' : 'translateX(6px)',
            background: 'white', border: '1px solid #e5e7eb', borderRadius: '7px',
            padding: '7px 10px', fontSize: '11px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
          }}>
            <p style={{ margin: '0 0 5px', fontWeight: 700, color: '#374151', fontSize: '10px' }}>
              {fechas[hoverI]}
            </p>
            {mesadas.map((m, mi) => {
              const dia = m.dias[hoverI];
              return (
                <div key={m.nombre} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: PALETA[mi % PALETA.length], flexShrink: 0 }} />
                  <span style={{ color: '#374151' }}>{m.nombre}</span>
                  <span style={{ color: dia?.cultivo ? colorNave : '#9ca3af', fontWeight: 600, marginLeft: 'auto', paddingLeft: 8 }}>
                    {dia?.cultivo ? '● ocupada' : '○ libre'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
        {mesadas.map((m, mi) => (
          <div key={m.nombre} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: 16, height: 3, background: PALETA[mi % PALETA.length], borderRadius: 2 }} />
            <span style={{ fontSize: '10px', color: '#6b7280' }}>{m.nombre}</span>
          </div>
        ))}
      </div>
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

  const esTipo = (m: MesadaOcupacion, tipo: Cultivo) => {
    const n = m.nombre.toLowerCase();
    if (tipo === 'lechuga') return n.includes('lechuga');
    if (tipo === 'rucula')  return n.includes('rucula') || n.includes('rúcula');
    return n.includes('albahaca');
  };

  const lechugaMesadas = filas.filter(m => esTipo(m, 'lechuga'));
  const ruculaMesadas  = filas.filter(m => esTipo(m, 'rucula'));
  const otrasMesadas   = filas.filter(m => !esTipo(m, 'lechuga') && !esTipo(m, 'rucula'));

  const colorNave = NAVE_COLOR[nave];

  return (
    <div>
      <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 700, color: colorNave, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Nave {nave}
      </p>
      {lechugaMesadas.length > 0 && (
        <MiniChart titulo="Lechuga" mesadas={lechugaMesadas} fechas={fechas} colorNave="#16a34a" />
      )}
      {ruculaMesadas.length > 0 && (
        <MiniChart titulo="Rúcula" mesadas={ruculaMesadas} fechas={fechas} colorNave="#ea580c" />
      )}
      {otrasMesadas.length > 0 && (
        <MiniChart titulo="Otras" mesadas={otrasMesadas} fechas={fechas} colorNave={colorNave} />
      )}
    </div>
  );
}
