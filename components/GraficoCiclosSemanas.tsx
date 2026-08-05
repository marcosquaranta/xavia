'use client';

export interface DatoSemana {
  semana: string;       // "S-7", "S-6", ..., "S0"
  lechugaF1: number;
  lechugaF2: number;
  rucula: number;
  lechugaCrespaF2: number;
  lechugaRobleF2: number;
}

interface Props { datos: DatoSemana[] }

export default function GraficoCiclosSemanas({ datos }: Props) {
  if (!datos.length) return (
    <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
      No hay cosechas en las últimas 8 semanas
    </div>
  );

  const maxDias = Math.max(...datos.flatMap(d => [d.lechugaCrespaF2, d.lechugaRobleF2, d.rucula]), 1);
  const W = 560, H = 260, PL = 36, PR = 12, PT = 16, PB = 28;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const slotW = chartW / datos.length;
  const barW = Math.min(22, slotW * 0.24);
  const gap = barW * 0.25;

  // 3 barras por semana: Crespa · Roble · Rúcula, centradas en el slot.
  function xC(i: number) { return PL + i * slotW + slotW / 2 - barW * 1.5 - gap; }
  function xB(i: number) { return PL + i * slotW + slotW / 2 - barW / 2; }
  function xR(i: number) { return PL + i * slotW + slotW / 2 + barW / 2 + gap; }
  function yH(d: number) { return (d / maxDias) * chartH; }
  const baseY = PT + chartH;

  const yRefs = [0, Math.round(maxDias * 0.5), maxDias];

  return (
    <div>
      {/* Leyenda */}
      <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', fontSize: '11px', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 12, background: '#84cc16', borderRadius: 2, display: 'inline-block' }} />Lechuga Crespa F2
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 12, background: '#4d7c0f', borderRadius: 2, display: 'inline-block' }} />Lechuga Roble F2
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 12, background: '#134e4a', borderRadius: 2, display: 'inline-block' }} />Rúcula
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {/* Grid Y */}
        {yRefs.map((v, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={baseY - yH(v)} y2={baseY - yH(v)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={PL - 4} y={baseY - yH(v) + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{v}d</text>
          </g>
        ))}
        <line x1={PL} x2={W - PR} y1={baseY} y2={baseY} stroke="#e5e7eb" strokeWidth={1} />

        {/* Barras */}
        {datos.map((d, i) => {
          const hC = yH(d.lechugaCrespaF2);
          const hB = yH(d.lechugaRobleF2);
          const hR = yH(d.rucula);
          return (
            <g key={i}>
              {/* Lechuga Crespa F2 */}
              {hC > 0 && <rect x={xC(i)} y={baseY - hC} width={barW} height={hC} fill="#84cc16" rx={2} />}
              {d.lechugaCrespaF2 > 0 && <text x={xC(i) + barW / 2} y={baseY - hC - 3} textAnchor="middle" fontSize={8} fill="#374151" fontWeight={500}>{d.lechugaCrespaF2}d</text>}

              {/* Lechuga Roble F2 */}
              {hB > 0 && <rect x={xB(i)} y={baseY - hB} width={barW} height={hB} fill="#4d7c0f" rx={2} />}
              {d.lechugaRobleF2 > 0 && <text x={xB(i) + barW / 2} y={baseY - hB - 3} textAnchor="middle" fontSize={8} fill="#374151" fontWeight={500}>{d.lechugaRobleF2}d</text>}

              {/* Rúcula */}
              {hR > 0 && <rect x={xR(i)} y={baseY - hR} width={barW} height={hR} fill="#134e4a" rx={2} />}
              {hR > 0 && <text x={xR(i) + barW / 2} y={baseY - hR - 3} textAnchor="middle" fontSize={8} fill="#374151" fontWeight={500}>{d.rucula}d</text>}

              {/* Label semana */}
              <text x={PL + i * slotW + slotW / 2} y={baseY + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">{d.semana}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
