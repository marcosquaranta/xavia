'use client';

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const COLORES: Record<string, string> = {
  'Lechuga Crespa': '#4d7c0f',
  'Lechuga Hoja de Roble': '#65a30d',
  'Rucula': '#166534',
  'Rúcula': '#166534',
  'Albahaca': '#047857',
};

function colorVariedad(v: string): string {
  return COLORES[v] || '#6b7280';
}

interface CurvaVariedad {
  variedad: string;
  datosActual: [number, number][];
  datosAnterior: [number, number][];
}

export default function GraficoEvolucion({
  curvas, anioActual, anioAnterior,
}: {
  curvas: CurvaVariedad[];
  anioActual: number;
  anioAnterior: number;
}) {
  const todos = curvas.flatMap(c => [
    ...c.datosActual.map(([,v]) => v),
    ...c.datosAnterior.map(([,v]) => v),
  ]);

  if (todos.length === 0) return (
    <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
      No hay cosechas registradas todavía. El gráfico se pobla a medida que registrés cosechas.
    </div>
  );

  const minV = Math.min(...todos);
  const maxV = Math.max(...todos);
  const pad = Math.max(5, Math.round((maxV - minV) * 0.2));
  const yMin = Math.max(0, minV - pad);
  const yMax = maxV + pad;
  const yR = yMax - yMin || 1;

  const W = 700, H = 280, L = 50, R = 660, T = 30, Bot = 230;
  const xS = (R - L) / 11;

  function px(m: number) { return L + m * xS + xS / 2; }
  function py(d: number) { return Bot - ((d - yMin) / yR) * (Bot - T); }
  function path(data: [number, number][]) {
    if (!data.length) return '';
    return [...data].sort((a, b) => a[0] - b[0])
      .map(([m, d], i) => (i === 0 ? 'M' : 'L') + ' ' + px(m) + ' ' + py(d))
      .join(' ');
  }

  const yLbls = [yMin, Math.round(yMin + yR * 0.33), Math.round(yMin + yR * 0.66), yMax];
  const hoyM = new Date().getMonth();

  return (
    <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '16px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Grid */}
        {yLbls.map((y, i) => (
          <g key={i}>
            <line x1={L} x2={R} y1={py(y)} y2={py(y)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={L - 6} y={py(y) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{y}d</text>
          </g>
        ))}
        <line x1={L} x2={R} y1={Bot} y2={Bot} stroke="#e5e7eb" strokeWidth={1} />

        {/* Meses */}
        {MESES.map((m, i) => (
          <text key={m} x={px(i)} y={Bot + 16} textAnchor="middle" fontSize={10} fill="#6b7280">{m}</text>
        ))}

        {/* Línea hoy */}
        <line x1={px(hoyM)} x2={px(hoyM)} y1={T} y2={Bot} stroke="#bfdbfe" strokeWidth={1.5} strokeDasharray="3 2" />
        <text x={px(hoyM)} y={T - 8} textAnchor="middle" fontSize={10} fill="#3b82f6" fontWeight={500}>hoy</text>

        {/* Curvas por variedad */}
        {curvas.map((c) => {
          const color = colorVariedad(c.variedad);
          return (
            <g key={c.variedad}>
              {/* Año anterior — línea punteada más tenue */}
              {c.datosAnterior.length > 0 && (
                <path d={path(c.datosAnterior)} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.4} />
              )}
              {/* Año actual */}
              {c.datosActual.length > 0 && (
                <>
                  <path d={path(c.datosActual)} fill="none" stroke={color} strokeWidth={2.5} />
                  {c.datosActual.map(([m, d]) => (
                    <circle key={m} cx={px(m)} cy={py(d)} r={3.5} fill={color} />
                  ))}
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* Leyenda */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '10px', fontSize: '12px' }}>
        {curvas.map((c) => (
          <div key={c.variedad} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width={20} height={10}>
              <line x1={0} y1={5} x2={20} y2={5} stroke={colorVariedad(c.variedad)} strokeWidth={2.5} />
              <circle cx={10} cy={5} r={3} fill={colorVariedad(c.variedad)} />
            </svg>
            <span style={{ color: '#374151' }}>{c.variedad} ({anioActual})</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width={20} height={10}>
            <line x1={0} y1={5} x2={20} y2={5} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4 3" />
          </svg>
          <span style={{ color: '#9ca3af' }}>{anioAnterior} (punteado)</span>
        </div>
      </div>
    </div>
  );
}
