'use client';

export interface PuntoProyeccionCosecha { semana: string; label: string; rucula: number; lechuga: number; albahaca: number }

interface Props { datos: PuntoProyeccionCosecha[] }

const COLOR_RUCULA = '#134e4a';
const COLOR_LECHUGA = '#84cc16';
const COLOR_ALBAHACA = '#15803d';
// Barras agrupadas: antes eran dos fijas (rúcula/lechuga) con posiciones calculadas a mano;
// ahora se arman desde esta lista para que sumar un cultivo no obligue a recalcular offsets.
const SERIES = [
  { key: 'rucula' as const, label: 'Rúcula', color: COLOR_RUCULA },
  { key: 'lechuga' as const, label: 'Lechuga', color: COLOR_LECHUGA },
  { key: 'albahaca' as const, label: 'Albahaca', color: COLOR_ALBAHACA },
];

export default function GraficoDistribucionMesadas({ datos }: Props) {
  if (!datos.length || datos.every((d) => SERIES.every((s) => (d[s.key] || 0) === 0))) {
    return (
      <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
        Sin cosechas estimadas en las próximas semanas
      </div>
    );
  }

  const maxVal = Math.max(...datos.flatMap((d) => SERIES.map((s) => d[s.key] || 0)), 1);
  const W = 720, H = 210, PAD_L = 40, PAD_R = 16, PAD_T = 20, PAD_B = 32;
  const chartW = W - PAD_L - PAD_R, chartH = H - PAD_T - PAD_B;
  const slotW = chartW / datos.length;
  const barW = Math.min(24, (slotW * 0.8) / SERIES.length);
  const gap = barW * 0.25;
  const anchoGrupo = SERIES.length * barW + (SERIES.length - 1) * gap;

  // x de la barra s (0..n-1) dentro del grupo de la columna i, centrado en el slot
  function xBarra(i: number, s: number) {
    return PAD_L + i * slotW + slotW / 2 - anchoGrupo / 2 + s * (barW + gap);
  }
  function yH(v: number) { return (v / maxVal) * chartH; }
  const baseY = PAD_T + chartH;
  const yRef = [0, Math.round(maxVal * 0.5), Math.round(maxVal)];
  const fmtVal = (v: number) => v > 999 ? Math.round(v / 100) / 10 + 'k' : Math.round(v);

  return (
    <div>
      <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', fontSize: '11px', color: '#6b7280', flexWrap: 'wrap' }}>
        {SERIES.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.label}
          </span>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {yRef.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={baseY - yH(v)} y2={baseY - yH(v)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={PAD_L - 4} y={baseY - yH(v) + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{fmtVal(v)}</text>
          </g>
        ))}

        {/* Fondo resaltando la semana actual (primera columna) */}
        <rect x={PAD_L} y={PAD_T} width={slotW} height={chartH} fill="#f9fafb" />

        {datos.map((d, i) => {
          return (
            <g key={d.semana}>
              {SERIES.map((s, si) => {
                const val = d[s.key] || 0;
                if (val <= 0) return null;
                const h = yH(val), x = xBarra(i, si);
                return (
                  <g key={s.key}>
                    <rect x={x} y={baseY - h} width={barW} height={h} fill={s.color} rx={2} />
                    <text x={x + barW / 2} y={baseY - h - 3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={500}>{fmtVal(val)}</text>
                  </g>
                );
              })}

              <text x={PAD_L + i * slotW + slotW / 2} y={baseY + 14} textAnchor="middle" fontSize={9}
                fill={i === 0 ? '#111827' : '#9ca3af'} fontWeight={i === 0 ? 700 : 400}>
                {d.label}
              </text>
            </g>
          );
        })}

        <line x1={PAD_L} x2={W - PAD_R} y1={baseY} y2={baseY} stroke="#e5e7eb" strokeWidth={1} />
      </svg>
    </div>
  );
}
