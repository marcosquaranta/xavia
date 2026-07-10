'use client';

export interface PuntoProyeccionCosecha { semana: string; label: string; rucula: number; lechuga: number }

interface Props { datos: PuntoProyeccionCosecha[] }

const COLOR_RUCULA = '#166534';
const COLOR_LECHUGA = '#4d7c0f';

export default function GraficoDistribucionMesadas({ datos }: Props) {
  if (!datos.length || datos.every((d) => d.rucula === 0 && d.lechuga === 0)) {
    return (
      <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
        Sin cosechas estimadas en las próximas semanas
      </div>
    );
  }

  const maxVal = Math.max(...datos.flatMap((d) => [d.rucula, d.lechuga]), 1);
  const W = 720, H = 210, PAD_L = 40, PAD_R = 16, PAD_T = 20, PAD_B = 32;
  const chartW = W - PAD_L - PAD_R, chartH = H - PAD_T - PAD_B;
  const slotW = chartW / datos.length;
  const barW = Math.min(24, slotW * 0.34);
  const gap = barW * 0.25;

  function xL(i: number) { return PAD_L + i * slotW + slotW / 2 - gap / 2 - barW; }
  function xR(i: number) { return PAD_L + i * slotW + slotW / 2 + gap / 2; }
  function yH(v: number) { return (v / maxVal) * chartH; }
  const baseY = PAD_T + chartH;
  const yRef = [0, Math.round(maxVal * 0.5), Math.round(maxVal)];
  const fmtVal = (v: number) => v > 999 ? Math.round(v / 100) / 10 + 'k' : Math.round(v);

  return (
    <div>
      <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', fontSize: '11px', color: '#6b7280', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_RUCULA, display: 'inline-block' }} />Rúcula
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_LECHUGA, display: 'inline-block' }} />Lechuga
        </span>
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
          const hR = yH(d.rucula), hL = yH(d.lechuga);
          const xl = xL(i), xr = xR(i);
          return (
            <g key={d.semana}>
              {d.rucula > 0 && <rect x={xl} y={baseY - hR} width={barW} height={hR} fill={COLOR_RUCULA} rx={2} />}
              {d.rucula > 0 && <text x={xl + barW / 2} y={baseY - hR - 3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={500}>{fmtVal(d.rucula)}</text>}

              {d.lechuga > 0 && <rect x={xr} y={baseY - hL} width={barW} height={hL} fill={COLOR_LECHUGA} rx={2} />}
              {d.lechuga > 0 && <text x={xr + barW / 2} y={baseY - hL - 3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={500}>{fmtVal(d.lechuga)}</text>}

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
