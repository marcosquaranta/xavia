'use client';

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const COLORES: Record<string, { total: string; f2: string }> = {
  'Lechuga Crespa':       { total: '#86efac', f2: '#4d7c0f' },
  'Lechuga Hoja de Roble':{ total: '#a3e635', f2: '#65a30d' },
  'Rucula':               { total: '#6ee7b7', f2: '#166534' },
  'Rúcula':               { total: '#6ee7b7', f2: '#166534' },
  'Albahaca':             { total: '#34d399', f2: '#047857' },
};
function col(v: string) { return COLORES[v] || { total: '#d1d5db', f2: '#6b7280' }; }

export interface CurvaVariedad {
  variedad: string;
  // mes → {total, f1, f2}
  datosActual: [number, { total: number; f1: number | null; f2: number }][];
  datosAnterior: [number, number][]; // año anterior solo total
}

export default function GraficoEvolucion({ curvas, anioActual, anioAnterior }: {
  curvas: CurvaVariedad[]; anioActual: number; anioAnterior: number;
}) {
  const todos = curvas.flatMap(c => [
    ...c.datosActual.map(([,v]) => v.total),
    ...c.datosAnterior.map(([,v]) => v),
  ]);
  if (!todos.length) return (
    <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
      No hay cosechas registradas. El gráfico se pobla a medida que registrés cosechas.
    </div>
  );

  const maxV = Math.max(...todos);
  const W = 700, H = 300, L = 50, R = 660, T = 30, Bot = 240;
  const xS = (R - L) / 11;
  function px(m: number) { return L + m * xS + xS / 2; }
  function py(d: number) { return Bot - (d / maxV) * (Bot - T); }
  function pathLine(data: [number, number][]) {
    if (!data.length) return '';
    return [...data].sort((a, b) => a[0] - b[0]).map(([m, d], i) => `${i === 0 ? 'M' : 'L'} ${px(m)} ${py(d)}`).join(' ');
  }
  function pathF2(data: [number, { total: number; f2: number }][]) {
    if (!data.length) return '';
    return [...data].sort((a, b) => a[0] - b[0]).map(([m, v], i) => `${i === 0 ? 'M' : 'L'} ${px(m)} ${py(v.f2)}`).join(' ');
  }

  const yRefs = [0, Math.round(maxV * 0.5), maxV];
  const hoyM = new Date().getMonth();

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
        {MESES.map((m, i) => (
          <text key={m} x={px(i)} y={Bot + 16} textAnchor="middle" fontSize={10} fill="#6b7280">{m}</text>
        ))}
        <line x1={px(hoyM)} x2={px(hoyM)} y1={T} y2={Bot} stroke="#bfdbfe" strokeWidth={1.5} strokeDasharray="3 2" />
        <text x={px(hoyM)} y={T - 8} textAnchor="middle" fontSize={10} fill="#3b82f6" fontWeight={500}>hoy</text>

        {curvas.map((c) => {
          const cl = col(c.variedad);
          const datF2 = c.datosActual.filter(([, v]) => v.f2 > 0) as [number, { total: number; f2: number }][];
          return (
            <g key={c.variedad}>
              {datF2.length > 0 && (
                <>
                  <path d={pathF2(datF2)} fill="none" stroke={cl.f2} strokeWidth={3} />
                  {datF2.map(([m, v]) => (
                    <g key={m}>
                      <circle cx={px(m)} cy={py(v.f2)} r={4} fill={cl.f2} />
                      <text x={px(m)} y={py(v.f2) - 8} textAnchor="middle" fontSize={9} fill={cl.f2} fontWeight={700}>{v.f2}d</text>
                    </g>
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
            <svg width={24} height={10}>
              <line x1={0} y1={5} x2={24} y2={5} stroke={col(c.variedad).f2} strokeWidth={3} />
              <circle cx={12} cy={5} r={3.5} fill={col(c.variedad).f2} />
            </svg>
            <span style={{ color: '#374151' }}>{c.variedad} F2</span>
          </div>
        ))}
      </div>
    </div>
  );
}
