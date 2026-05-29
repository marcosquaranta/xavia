'use client';

export interface BarraSemana {
  semana: number;
  plantas_f1: number;
  plantas_f2: number;
  plantas_cosechadas?: number; // cosechados últimos 7 días
  lotes: string[];
}

interface Props {
  titulo: string;
  color: string;
  colorF1: string;
  colorF2: string;
  barras: BarraSemana[];
  semanasCosecha: number;
  semanaActual?: number;
  sinF1?: boolean; // rúcula no tiene F1
}

export default function GraficoCiclos({ titulo, color, colorF1, colorF2, barras, semanasCosecha, sinF1 }: Props) {
  const todasLasBarras = barras.filter(b =>
    (b.plantas_f1 + b.plantas_f2 + (b.plantas_cosechadas || 0)) > 0
  );

  if (todasLasBarras.length === 0) {
    return (
      <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
        Sin lotes activos en mesadas
      </div>
    );
  }

  const maxSemana = Math.max(semanasCosecha + 1, ...barras.map(b => b.semana));
  const semanas = Array.from({ length: maxSemana }, (_, i) => i + 1);
  const maxPlantas = Math.max(...barras.map(b => b.plantas_f1 + b.plantas_f2 + (b.plantas_cosechadas || 0)), 1);

  const W = 560, H = 160;
  const PAD_L = 44, PAD_R = 16, PAD_T = 16, PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const barW = Math.min(36, chartW / semanas.length - 4);
  const gap = chartW / semanas.length;

  function xBar(sem: number) { return PAD_L + (sem - 1) * gap + gap / 2; }
  function yH(plantas: number) { return (plantas / maxPlantas) * chartH; }

  const yRef = [0, Math.round(maxPlantas * 0.5), maxPlantas];
  const xCosecha = xBar(semanasCosecha);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ background: color, color: 'white', padding: '2px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.5px' }}>
          {titulo.toUpperCase()}
        </span>
        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#6b7280' }}>
          {!sinF1 && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: colorF1, display: 'inline-block' }} />F1
          </span>}
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: colorF2, display: 'inline-block' }} />F2
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#d1d5db', display: 'inline-block' }} />Cosechado (7d)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 2, height: 10, background: '#ef4444', display: 'inline-block' }} />cosecha est.
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {/* Grid Y */}
        {yRef.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + chartH - yH(v)} y2={PAD_T + chartH - yH(v)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={PAD_L - 4} y={PAD_T + chartH - yH(v) + 4} textAnchor="end" fontSize={9} fill="#9ca3af">
              {v > 999 ? Math.round(v / 1000) + 'k' : v}
            </text>
          </g>
        ))}

        {/* Barras por semana */}
        {semanas.map((sem) => {
          const barra = barras.find(b => b.semana === sem);
          const f1 = barra?.plantas_f1 ?? 0;
          const f2 = barra?.plantas_f2 ?? 0;
          const cosechadas = barra?.plantas_cosechadas ?? 0;
          const total = f1 + f2 + cosechadas;
          const hF2 = yH(f2);
          const hF1 = yH(f1);
          const hCos = yH(cosechadas);
          const x = xBar(sem) - barW / 2;
          const baseY = PAD_T + chartH;

          return (
            <g key={sem}>
              {/* Cosechadas (abajo, gris) */}
              {cosechadas > 0 && (
                <rect x={x} y={baseY - hCos} width={barW} height={hCos} fill="#d1d5db" rx={2} opacity={0.7} />
              )}
              {/* F2 (encima de cosechadas) */}
              {f2 > 0 && (
                <rect x={x} y={baseY - hCos - hF2} width={barW} height={hF2} fill={colorF2} rx={2} />
              )}
              {/* F1 (encima de F2) — solo si no es sinF1 */}
              {!sinF1 && f1 > 0 && (
                <rect x={x} y={baseY - hCos - hF2 - hF1} width={barW} height={hF1} fill={colorF1} rx={2} />
              )}
              {/* Total */}
              {total > 0 && (
                <text x={xBar(sem)} y={baseY - hCos - hF2 - hF1 - 3} textAnchor="middle" fontSize={9} fill="#4b5563" fontWeight={500}>
                  {total > 999 ? Math.round(total / 100) / 10 + 'k' : total}
                </text>
              )}
            </g>
          );
        })}

        {/* Línea de cosecha estimada */}
        <line x1={xCosecha} x2={xCosecha} y1={PAD_T - 4} y2={PAD_T + chartH} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={xCosecha} y={PAD_T - 6} textAnchor="middle" fontSize={9} fill="#ef4444" fontWeight={600}>cosecha</text>

        {/* Eje X */}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + chartH} y2={PAD_T + chartH} stroke="#e5e7eb" strokeWidth={1} />
        {semanas.map((sem) => (
          <text key={sem} x={xBar(sem)} y={PAD_T + chartH + 14} textAnchor="middle" fontSize={9} fill={sem === semanasCosecha ? '#ef4444' : '#9ca3af'}>
            S{sem}
          </text>
        ))}
      </svg>
    </div>
  );
}
