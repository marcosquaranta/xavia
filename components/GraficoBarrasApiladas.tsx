'use client';

export interface SerieApilada { nombre: string; color: string; valores: number[] }

interface Props { labels: string[]; series: SerieApilada[]; unidad?: string }

// Columna apilada genérica: una barra por label (mes), dividida en los tramos de `series`
// apilados uno arriba del otro, mismo tamaño que el total de esa columna.
export default function GraficoBarrasApiladas({ labels, series, unidad = '' }: Props) {
  const totales = labels.map((_, i) => series.reduce((a, s) => a + (s.valores[i] || 0), 0));
  const maxVal = Math.max(...totales, 1);
  if (totales.every((t) => t === 0)) {
    return (
      <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
        Sin descarte registrado en este período.
      </div>
    );
  }

  const W = 720, H = 210, PAD_L = 40, PAD_R = 16, PAD_T = 20, PAD_B = 32;
  const chartW = W - PAD_L - PAD_R, chartH = H - PAD_T - PAD_B;
  const slotW = chartW / labels.length;
  const barW = Math.min(28, slotW * 0.55);
  const baseY = PAD_T + chartH;
  const yH = (v: number) => (v / maxVal) * chartH;
  const yRef = [0, Math.round(maxVal * 0.5), Math.round(maxVal)];
  const fmtVal = (v: number) => (v > 999 ? Math.round(v / 100) / 10 + 'k' : Math.round(v));
  const stepLbl = labels.length > 14 ? 2 : 1;

  return (
    <div>
      <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', fontSize: '11px', color: '#6b7280', flexWrap: 'wrap' }}>
        {series.map((s) => (
          <span key={s.nombre} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.nombre}
          </span>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {yRef.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={baseY - yH(v)} y2={baseY - yH(v)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={PAD_L - 4} y={baseY - yH(v) + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{fmtVal(v)}{unidad}</text>
          </g>
        ))}

        {labels.map((label, i) => {
          const x = PAD_L + i * slotW + (slotW - barW) / 2;
          let acumulado = 0;
          const total = totales[i];
          return (
            <g key={label}>
              {series.map((s) => {
                const v = s.valores[i] || 0;
                if (v <= 0) return null;
                const h = yH(v);
                const y = baseY - yH(acumulado) - h;
                acumulado += v;
                return <rect key={s.nombre} x={x} y={y} width={barW} height={h} fill={s.color} />;
              })}
              {total > 0 && (
                <text x={x + barW / 2} y={baseY - yH(total) - 3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={500}>{fmtVal(total)}</text>
              )}
              {(i % stepLbl === 0) && (
                <text x={x + barW / 2} y={baseY + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">{label}</text>
              )}
            </g>
          );
        })}

        <line x1={PAD_L} x2={W - PAD_R} y1={baseY} y2={baseY} stroke="#e5e7eb" strokeWidth={1} />
      </svg>
    </div>
  );
}
