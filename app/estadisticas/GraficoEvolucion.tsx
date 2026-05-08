// app/estadisticas/GraficoEvolucion.tsx
// Gráfico SVG comparando ciclos mes a mes entre dos años.
// Recibe arrays de pares [mes, dias] (serializables desde server components).
'use client';

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

export default function GraficoEvolucion({
  datosActual,
  datosAnterior,
  anioActual,
  anioAnterior,
}: {
  datosActual: [number, number][];
  datosAnterior: [number, number][];
  anioActual: number;
  anioAnterior: number;
}) {
  const todos = [
    ...datosActual.map(([, v]) => v),
    ...datosAnterior.map(([, v]) => v),
  ];

  if (todos.length === 0) {
    return (
      <div
        style={{
          background: '#fafafa',
          border: '1px solid #f3f4f6',
          borderRadius: '8px',
          padding: '40px',
          textAlign: 'center',
          color: '#9ca3af',
          fontSize: '13px',
        }}
      >
        No hay cosechas registradas todavía. El gráfico se va a poblar a medida
        que registrés cosechas.
      </div>
    );
  }

  const minVal = Math.min(...todos);
  const maxVal = Math.max(...todos);
  const pad = Math.max(2, Math.round((maxVal - minVal) * 0.2));
  const yMin = Math.max(0, minVal - pad);
  const yMax = maxVal + pad;
  const yRange = yMax - yMin || 1;

  const W = 700;
  const H = 260;
  const LEFT = 50;
  const RIGHT = 660;
  const TOP = 30;
  const BOTTOM = 220;
  const xStep = (RIGHT - LEFT) / 11;

  function px(mes: number) { return LEFT + mes * xStep + xStep / 2; }
  function py(dias: number) { return BOTTOM - ((dias - yMin) / yRange) * (BOTTOM - TOP); }

  function buildPath(datos: [number, number][]) {
    if (datos.length === 0) return '';
    const sorted = [...datos].sort((a, b) => a[0] - b[0]);
    return sorted.map(([m, d], i) => `${i === 0 ? 'M' : 'L'} ${px(m)} ${py(d)}`).join(' ');
  }

  // Líneas de referencia Y
  const yLabels = [yMin, Math.round(yMin + yRange * 0.33), Math.round(yMin + yRange * 0.66), yMax];
  const hoyMes = new Date().getMonth();

  return (
    <div
      style={{
        background: '#fafafa',
        border: '1px solid #f3f4f6',
        borderRadius: '8px',
        padding: '16px',
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Grid Y */}
        {yLabels.map((y, i) => (
          <g key={i}>
            <line x1={LEFT} x2={RIGHT} y1={py(y)} y2={py(y)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={LEFT - 6} y={py(y) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">
              {y}d
            </text>
          </g>
        ))}

        {/* Eje X */}
        <line x1={LEFT} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} stroke="#e5e7eb" strokeWidth={1} />
        {MESES.map((m, i) => (
          <text key={m} x={px(i)} y={BOTTOM + 16} textAnchor="middle" fontSize={10} fill="#6b7280">
            {m}
          </text>
        ))}

        {/* Línea "hoy" */}
        <line
          x1={px(hoyMes)} x2={px(hoyMes)}
          y1={TOP} y2={BOTTOM}
          stroke="#bfdbfe" strokeWidth={1.5} strokeDasharray="3 2"
        />
        <text x={px(hoyMes)} y={TOP - 8} textAnchor="middle" fontSize={10} fill="#3b82f6" fontWeight={500}>
          hoy
        </text>

        {/* Línea año anterior (gris punteado) */}
        {datosAnterior.length > 0 && (
          <path d={buildPath(datosAnterior)} fill="none" stroke="#d1d5db" strokeWidth={2} strokeDasharray="5 4" />
        )}

        {/* Línea año actual (verde sólido) + puntos */}
        {datosActual.length > 0 && (
          <>
            <path d={buildPath(datosActual)} fill="none" stroke="#059669" strokeWidth={2.5} />
            {datosActual.map(([m, d]) => (
              <circle key={m} cx={px(m)} cy={py(d)} r={3.5} fill="#059669" />
            ))}
          </>
        )}
      </svg>

      {/* Leyenda */}
      <div style={{ display: 'flex', gap: '18px', justifyContent: 'center', marginTop: '10px', fontSize: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width={20} height={3}>
            <line x1={0} y1={1.5} x2={20} y2={1.5} stroke="#059669" strokeWidth={2.5} />
          </svg>
          <span>{anioActual}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width={20} height={3}>
            <line x1={0} y1={1.5} x2={20} y2={1.5} stroke="#d1d5db" strokeWidth={2} strokeDasharray="4 3" />
          </svg>
          <span style={{ color: '#6b7280' }}>{anioAnterior}</span>
        </div>
      </div>
    </div>
  );
}
