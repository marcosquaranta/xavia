'use client';

export interface BarraSemana {
  semana: number;
  plantas_f1: number;
  plantas_f2: number;
  plantas_cosechadas?: number;
  lotes: string[];
}

interface Props {
  barrasLechuga: BarraSemana[];
  barrasRucula: BarraSemana[];
  semanasCosechaLechuga: number;
  semanasCosechaRucula: number;
  factorLechuga?: number; // paq/planta lechuga (normalmente 1)
  factorRucula?: number;  // paq/planta rúcula (normalmente 3)
}

const COLOR_LECHUGA_F1 = '#86efac';
const COLOR_LECHUGA_F2 = '#4d7c0f';
const COLOR_RUCULA_F2 = '#166534';
const COLOR_COSECHADO = '#d1d5db';

export default function GraficoDistribucionMesadas({
  barrasLechuga, barrasRucula, semanasCosechaLechuga, semanasCosechaRucula, factorLechuga = 1, factorRucula = 3,
}: Props) {
  const convL = (pl: number) => factorLechuga > 1 ? pl / factorLechuga : pl;
  const convR = (pl: number) => factorRucula > 0 ? pl / factorRucula : pl;

  const activasL = barrasLechuga.filter(b => b.plantas_f1 + b.plantas_f2 + (b.plantas_cosechadas || 0) > 0);
  const activasR = barrasRucula.filter(b => b.plantas_f1 + b.plantas_f2 + (b.plantas_cosechadas || 0) > 0);

  if (activasL.length === 0 && activasR.length === 0) {
    return (
      <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
        Sin lotes activos en mesadas
      </div>
    );
  }

  const minSemana = 1;
  const maxSemana = Math.max(
    semanasCosechaLechuga + 1, semanasCosechaRucula + 1,
    ...activasL.map(b => b.semana), ...activasR.map(b => b.semana), 1,
  );
  const semanas = Array.from({ length: maxSemana - minSemana + 1 }, (_, i) => i + minSemana);

  const maxPaq = Math.max(
    ...barrasLechuga.map(b => convL(b.plantas_f1 + b.plantas_f2 + (b.plantas_cosechadas || 0))),
    ...barrasRucula.map(b => convR(b.plantas_f1 + b.plantas_f2 + (b.plantas_cosechadas || 0))),
    1,
  );

  const W = 720, H = 200, PAD_L = 40, PAD_R = 16, PAD_T = 24, PAD_B = 28;
  const chartW = W - PAD_L - PAD_R, chartH = H - PAD_T - PAD_B;
  const slotW = chartW / semanas.length;
  const barW = Math.min(20, slotW * 0.32);
  const gap = barW * 0.25;

  function xL(i: number) { return PAD_L + i * slotW + slotW / 2 - gap / 2 - barW; }
  function xR(i: number) { return PAD_L + i * slotW + slotW / 2 + gap / 2; }
  function yH(v: number) { return (v / maxPaq) * chartH; }
  const baseY = PAD_T + chartH;
  const yRef = [0, Math.round(maxPaq * 0.5), Math.round(maxPaq)];
  const fmtVal = (v: number) => v > 999 ? Math.round(v / 100) / 10 + 'k' : Math.round(v * 10) / 10;

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '8px', fontSize: '11px', color: '#6b7280', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_LECHUGA_F1, display: 'inline-block' }} />Lechuga F1
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_LECHUGA_F2, display: 'inline-block' }} />Lechuga F2
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_RUCULA_F2, display: 'inline-block' }} />Rúcula F2
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_COSECHADO, display: 'inline-block' }} />Cosechado (7d)
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {yRef.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={baseY - yH(v)} y2={baseY - yH(v)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={PAD_L - 4} y={baseY - yH(v) + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{fmtVal(v)}</text>
          </g>
        ))}

        {semanas.map((sem, i) => {
          const bL = barrasLechuga.find(b => b.semana === sem);
          const bR = barrasRucula.find(b => b.semana === sem);
          const f1L = convL(bL?.plantas_f1 ?? 0), f2L = convL(bL?.plantas_f2 ?? 0), cosL = convL(bL?.plantas_cosechadas ?? 0);
          const f2R = convR(bR?.plantas_f2 ?? 0), cosR = convR(bR?.plantas_cosechadas ?? 0);
          const totalL = f1L + f2L + cosL, totalR = f2R + cosR;
          const hF1L = yH(f1L), hF2L = yH(f2L), hCosL = yH(cosL);
          const hF2R = yH(f2R), hCosR = yH(cosR);
          const xl = xL(i), xr = xR(i);

          return (
            <g key={sem}>
              {/* Lechuga: cosechado / F2 / F1 apilado */}
              {cosL > 0 && <rect x={xl} y={baseY - hCosL} width={barW} height={hCosL} fill={COLOR_COSECHADO} rx={2} opacity={0.7} />}
              {f2L > 0 && <rect x={xl} y={baseY - hCosL - hF2L} width={barW} height={hF2L} fill={COLOR_LECHUGA_F2} rx={2} />}
              {f1L > 0 && <rect x={xl} y={baseY - hCosL - hF2L - hF1L} width={barW} height={hF1L} fill={COLOR_LECHUGA_F1} rx={2} />}
              {totalL > 0 && <text x={xl + barW / 2} y={baseY - hCosL - hF2L - hF1L - 3} textAnchor="middle" fontSize={8.5} fill="#4b5563" fontWeight={500}>{fmtVal(totalL)}</text>}

              {/* Rúcula: cosechado / F2 apilado */}
              {cosR > 0 && <rect x={xr} y={baseY - hCosR} width={barW} height={hCosR} fill={COLOR_COSECHADO} rx={2} opacity={0.7} />}
              {f2R > 0 && <rect x={xr} y={baseY - hCosR - hF2R} width={barW} height={hF2R} fill={COLOR_RUCULA_F2} rx={2} />}
              {totalR > 0 && <text x={xr + barW / 2} y={baseY - hCosR - hF2R - 3} textAnchor="middle" fontSize={8.5} fill="#4b5563" fontWeight={500}>{fmtVal(totalR)}</text>}

              {/* Label semana — coloreado si coincide con la cosecha estimada de algún cultivo */}
              <text x={PAD_L + i * slotW + slotW / 2} y={baseY + 14} textAnchor="middle" fontSize={9}
                fill={sem === semanasCosechaLechuga ? COLOR_LECHUGA_F2 : sem === semanasCosechaRucula ? COLOR_RUCULA_F2 : '#9ca3af'}>
                S{sem}
              </text>
            </g>
          );
        })}

        <line x1={PAD_L} x2={W - PAD_R} y1={baseY} y2={baseY} stroke="#e5e7eb" strokeWidth={1} />
      </svg>
    </div>
  );
}
