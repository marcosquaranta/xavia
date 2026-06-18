'use client';

export interface DatoSemana {
  semana: string;       // "S-7", "S-6", ..., "S0"
  lechugaF1: number;
  lechugaF2: number;
  rucula: number;
}

interface Props { datos: DatoSemana[] }

export default function GraficoCiclosSemanas({ datos }: Props) {
  if (!datos.length) return (
    <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
      No hay cosechas en las últimas 8 semanas
    </div>
  );

  const maxDias = Math.max(...datos.flatMap(d => [d.lechugaF1 + d.lechugaF2, d.rucula]), 1);
  const W = 560, H = 260, PL = 36, PR = 12, PT = 16, PB = 28;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const slotW = chartW / datos.length;
  const barW = Math.min(32, slotW * 0.38);
  const gap = barW * 0.3;

  function xL(i: number) { return PL + i * slotW + slotW / 2 - gap / 2 - barW; }
  function xR(i: number) { return PL + i * slotW + slotW / 2 + gap / 2; }
  function yH(d: number) { return (d / maxDias) * chartH; }
  const baseY = PT + chartH;

  const yRefs = [0, Math.round(maxDias * 0.5), maxDias];

  return (
    <div>
      {/* Leyenda */}
      <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', fontSize: '11px', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 12, background: '#86efac', borderRadius: 2, display: 'inline-block' }} />Lechuga F1
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 12, background: '#4d7c0f', borderRadius: 2, display: 'inline-block' }} />Lechuga F2
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 12, background: '#166534', borderRadius: 2, display: 'inline-block' }} />Rúcula
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
          const hF1 = yH(d.lechugaF1);
          const hF2 = yH(d.lechugaF2);
          const hR  = yH(d.rucula);
          const totalL = d.lechugaF1 + d.lechugaF2;
          return (
            <g key={i}>
              {/* Lechuga: F2 abajo, F1 encima */}
              {hF2 > 0 && <rect x={xL(i)} y={baseY - hF2} width={barW} height={hF2} fill="#4d7c0f" rx={2} />}
              {hF1 > 0 && <rect x={xL(i)} y={baseY - hF2 - hF1} width={barW} height={hF1} fill="#86efac" rx={2} />}
              {totalL > 0 && <text x={xL(i) + barW / 2} y={baseY - hF2 - hF1 - 3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={500}>{totalL}d</text>}

              {/* Rúcula */}
              {hR > 0 && <rect x={xR(i)} y={baseY - hR} width={barW} height={hR} fill="#166534" rx={2} />}
              {hR > 0 && <text x={xR(i) + barW / 2} y={baseY - hR - 3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={500}>{d.rucula}d</text>}

              {/* Label semana */}
              <text x={PL + i * slotW + slotW / 2} y={baseY + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">{d.semana}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
