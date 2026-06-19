'use client';

export interface SerieEvo {
  nombre: string;
  color: string;
  puntos: [number, number][]; // [bucketIndex, dias]
}

export default function GraficoEvolucion({ series, labels, hoyIdx }: {
  series: SerieEvo[]; labels: string[]; hoyIdx: number;
}) {
  const todos = series.flatMap(s => s.puntos.map(p => p[1]));
  if (!todos.length) return (
    <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
      No hay cosechas registradas en este período.
    </div>
  );

  const maxV = Math.max(...todos, 10);
  const n = labels.length;
  const W = 700, H = 300, L = 50, R = 660, T = 30, Bot = 240;
  const px = (i: number) => n <= 1 ? (L + R) / 2 : L + i * (R - L) / (n - 1);
  const py = (d: number) => Bot - (d / maxV) * (Bot - T);
  function pathLine(pts: [number, number][]) {
    if (!pts.length) return '';
    return [...pts].sort((a, b) => a[0] - b[0]).map(([i, d], k) => `${k === 0 ? 'M' : 'L'} ${px(i)} ${py(d)}`).join(' ');
  }

  const yRefs = [0, Math.round(maxV * 0.5), maxV];
  // Para muchos labels (semanas) mostrar uno de cada N para no amontonar
  const stepLbl = n > 14 ? 2 : 1;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {yRefs.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={R} y1={py(v)} y2={py(v)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={L - 6} y={py(v) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}d</text>
          </g>
        ))}
        <line x1={L} x2={R} y1={Bot} y2={Bot} stroke="#e5e7eb" strokeWidth={1} />
        {labels.map((m, i) => (i % stepLbl === 0) && (
          <text key={i} x={px(i)} y={Bot + 16} textAnchor="middle" fontSize={10} fill="#6b7280">{m}</text>
        ))}
        {hoyIdx >= 0 && hoyIdx < n && (
          <>
            <line x1={px(hoyIdx)} x2={px(hoyIdx)} y1={T} y2={Bot} stroke="#bfdbfe" strokeWidth={1.5} strokeDasharray="3 2" />
            <text x={px(hoyIdx)} y={T - 8} textAnchor="middle" fontSize={10} fill="#3b82f6" fontWeight={500}>hoy</text>
          </>
        )}

        {series.map((s) => {
          const pts = [...s.puntos].sort((a, b) => a[0] - b[0]);
          if (!pts.length) return null;
          return (
            <g key={s.nombre}>
              <path d={pathLine(pts)} fill="none" stroke={s.color} strokeWidth={3} />
              {pts.map(([i, d]) => (
                <g key={i}>
                  <circle cx={px(i)} cy={py(d)} r={4} fill={s.color} />
                  <text x={px(i)} y={py(d) - 8} textAnchor="middle" fontSize={9} fill={s.color} fontWeight={700}>{d}d</text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>

      {/* Leyenda */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '10px', fontSize: '12px' }}>
        {series.map((s) => (
          <div key={s.nombre} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width={24} height={10}>
              <line x1={0} y1={5} x2={24} y2={5} stroke={s.color} strokeWidth={3} />
              <circle cx={12} cy={5} r={3.5} fill={s.color} />
            </svg>
            <span style={{ color: '#374151' }}>{s.nombre}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
