// app/estadisticas/GraficoEvolucion.tsx
// Gráfico SVG simple comparando ciclos mes a mes entre dos años.

'use client';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

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
  // Si no hay datos, mostrar mensaje
  const todosLosDatos = [...datosActual.map(([_, v]) => v), ...datosAnterior.map(([_, v]) => v)];
  if (todosLosDatos.length === 0) {
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
        No hay suficientes cosechas registradas para mostrar el gráfico todavía.
        <br />
        Se va a poblar a medida que vayas registrando cosechas.
      </div>
    );
  }

  const minDias = Math.min(...todosLosDatos);
  const maxDias = Math.max(...todosLosDatos);
  const padding = Math.max(2, Math.round((maxDias - minDias) * 0.15));
  const yMin = Math.max(0, minDias - padding);
  const yMax = maxDias + padding;
  const yRange = yMax - yMin || 1;

  const W = 700;
  const H = 280;
  const left = 50;
  const right = 660;
  const top = 40;
  const bottom = 240;
  const xStep = (right - left) / 11;

  function pointX(mes: number): number {
    return left + mes * xStep + 25;
  }

  function pointY(dias: number): number {
    return bottom - ((dias - yMin) / yRange) * (bottom - top);
  }

  function buildPath(datos: [number, number][]): string {
    if (datos.length === 0) return '';
    const sorted = [...datos].sort((a, b) => a[0] - b[0]);
    return sorted
      .map(([mes, dias], i) => `${i === 0 ? 'M' : 'L'} ${pointX(mes)} ${pointY(dias)}`)
      .join(' ');
  }

  // Líneas de referencia del eje Y
  const yLabels = [yMin, Math.round(yMin + yRange * 0.33), Math.round(yMin + yRange * 0.66), yMax];

  // Línea vertical de "hoy"
  const hoyMes = new Date().getMonth();

  return (
    <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '16px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Grid horizontal */}
        {yLabels.map((y, i) => (
          <line
            key={i}
            x1={left}
            x2={right}
            y1={pointY(y)}
            y2={pointY(y)}
            stroke="#f3f4f6"
            strokeWidth={1}
          />
        ))}

        {/* Labels eje Y */}
        {yLabels.map((y, i) => (
          <text
            key={i}
            x={left - 8}
            y={pointY(y) + 4}
            textAnchor="end"
            fontSize={10}
            fill="#9ca3af"
          >
            {y}d
          </text>
        ))}

        {/* Eje X */}
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#e5e7eb" strokeWidth={1} />

        {/* Labels eje X */}
        {MESES.map((m, i) => (
          <text
            key={m}
            x={pointX(i)}
            y={bottom + 18}
            textAnchor="middle"
            fontSize={10}
            fill="#6b7280"
          >
            {m}
          </text>
        ))}

        {/* Línea de hoy */}
        <line
          x1={pointX(hoyMes)}
          x2={pointX(hoyMes)}
          y1={top}
          y2={bottom}
          stroke="#dbeafe"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
        <text
          x={pointX(hoyMes)}
          y={top - 8}
          textAnchor="middle"
          fontSize={10}
          fill="#3b82f6"
          fontWeight={500}
        >
          hoy
        </text>

        {/* Línea año anterior (gris punteado) */}
        {datosAnterior.length > 0 && (
          <path
            d={buildPath(datosAnterior)}
            fill="none"
            stroke="#9ca3af"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}

        {/* Línea año actual (verde sólido) */}
        {datosActual.length > 0 && (
          <>
            <path
              d={buildPath(datosActual)}
              fill="none"
              stroke="#059669"
              strokeWidth={2.5}
            />
            {datosActual.map(([mes, dias]) => (
              <circle
                key={mes}
                cx={pointX(mes)}
                cy={pointY(dias)}
                r={3}
                fill="#059669"
              />
            ))}
          </>
        )}
      </svg>

      <div
        style={{
          display: 'flex',
          gap: '18px',
          justifyContent: 'center',
          marginTop: '12px',
          fontSize: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width={20} height={3}>
            <line x1={0} y1={1.5} x2={20} y2={1.5} stroke="#059669" strokeWidth={2.5} />
          </svg>
          <span>{anioActual}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width={20} height={3}>
            <line
              x1={0}
              y1={1.5}
              x2={20}
              y2={1.5}
              stroke="#9ca3af"
              strokeWidth={2}
              strokeDasharray="3 2"
            />
          </svg>
          <span style={{ color: '#6b7280' }}>{anioAnterior}</span>
        </div>
      </div>
    </div>
  );
}
