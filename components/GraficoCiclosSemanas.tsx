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

// Línea en vez de barras (a pedido explícito) — con 8 semanas seguidas, una línea muestra
// la TENDENCIA de un vistazo (¿viene subiendo o bajando?) mejor que barras sueltas. El
// valor exacto de la última semana ya se ve en las tarjetas de abajo (page.tsx), así que
// acá no se etiqueta cada punto — con 3 líneas cerca unas de otras (35-39 días) los números
// se pisarían.
const SERIES = [
  { key: 'lechugaCrespaF2' as const, label: 'Lechuga Crespa F2', color: '#84cc16' },
  { key: 'lechugaRobleF2' as const, label: 'Lechuga Roble F2', color: '#4d7c0f' },
  { key: 'rucula' as const, label: 'Rúcula', color: '#134e4a' },
];

export default function GraficoCiclosSemanas({ datos }: Props) {
  if (!datos.length) return (
    <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
      No hay cosechas en las últimas 8 semanas
    </div>
  );

  const maxDias = Math.max(...datos.flatMap(d => SERIES.map(s => d[s.key])), 1);
  const W = 560, H = 260, PL = 36, PR = 12, PT = 16, PB = 28;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const n = datos.length;
  const xAt = (i: number) => n > 1 ? PL + (i * chartW) / (n - 1) : PL + chartW / 2;
  const yH = (d: number) => (d / maxDias) * chartH;
  const baseY = PT + chartH;

  const yRefs = [0, Math.round(maxDias * 0.5), maxDias];

  // 0 = "sin cosecha esa semana" (no "ciclo de 0 días" — ver el filtro `> 0` que ya usa
  // page.tsx para las tarjetas). Une en línea solo las semanas CONSECUTIVAS con dato: una
  // semana sin cosecha corta la línea en vez de hacerla caer a cero.
  function tramos(key: (typeof SERIES)[number]['key']) {
    const grupos: { i: number; v: number }[][] = [];
    let actual: { i: number; v: number }[] = [];
    datos.forEach((d, i) => {
      if (d[key] > 0) { actual.push({ i, v: d[key] }); }
      else if (actual.length) { grupos.push(actual); actual = []; }
    });
    if (actual.length) grupos.push(actual);
    return grupos;
  }

  return (
    <div>
      {/* Leyenda */}
      <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', fontSize: '11px', flexWrap: 'wrap' }}>
        {SERIES.map(s => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 12, height: 12, background: s.color, borderRadius: 2, display: 'inline-block' }} />{s.label}
          </span>
        ))}
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

        {/* Líneas + puntos, una serie por cultivo */}
        {SERIES.map(s => (
          <g key={s.key}>
            {tramos(s.key).map((grupo, gi) => (
              <g key={gi}>
                {grupo.length > 1 && (
                  <polyline
                    points={grupo.map(({ i, v }) => `${xAt(i)},${baseY - yH(v)}`).join(' ')}
                    fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  />
                )}
                {grupo.map(({ i, v }) => (
                  <circle key={i} cx={xAt(i)} cy={baseY - yH(v)} r={3} fill={s.color} />
                ))}
              </g>
            ))}
          </g>
        ))}

        {/* Label semana */}
        {datos.map((d, i) => (
          <text key={d.semana} x={xAt(i)} y={baseY + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">{d.semana}</text>
        ))}
      </svg>
    </div>
  );
}
