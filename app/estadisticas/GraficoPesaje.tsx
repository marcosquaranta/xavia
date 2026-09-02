'use client';

interface PuntoPesaje { fecha: string; variedad: string; peso_gr: number; paquetes: number; }

const CULTIVOS = [
  { key: 'rucula', label: 'Rúcula', color: '#134e4a', bg: '#dcfce7' },
  { key: 'lechuga', label: 'Lechuga', color: '#84cc16', bg: '#f0fdf4' },
];

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// `escala` dice cómo leer la fecha de cada punto, no una función de formato: este es un
// componente cliente y las páginas que lo usan son server components — una función pasada
// como prop no se puede serializar y hace explotar la página entera en runtime.
export default function GraficoPesaje({ puntos, escala = 'dia' }: { puntos: PuntoPesaje[]; escala?: 'dia' | 'mes' }) {
  // 'dia' = fecha real YYYY-MM-DD → "MM-DD". 'mes' = fecha sintética YYYY-MM → "Ago 26".
  const fmtLabel = (f: string) => {
    if (escala !== 'mes') return f.slice(5);
    const [y, m] = f.split('-').map(Number);
    return `${MESES_CORTO[m - 1] || ''} ${String(y).slice(2)}`;
  };
  if (!puntos.length) return (
    <div style={{ background: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
      No hay cosechas con pesaje testigo registradas. Se actualizará cuando se registren cosechas por paquete con peso.
    </div>
  );

  // Agrupar por (fecha, cultivo) y promediar pesos
  function agrupar(cultivo: string): { fecha: string; peso_gr: number }[] {
    const esRucula = (v: string) => v.toLowerCase().includes('rucula') || v.toLowerCase().includes('rúcula');
    const filtrados = puntos.filter(p => cultivo === 'rucula' ? esRucula(p.variedad) : !esRucula(p.variedad));
    const byFecha = new Map<string, number[]>();
    for (const p of filtrados) {
      const arr = byFecha.get(p.fecha) || [];
      arr.push(p.peso_gr);
      byFecha.set(p.fecha, arr);
    }
    return [...byFecha.entries()]
      .map(([fecha, pesos]) => ({ fecha, peso_gr: Math.round(pesos.reduce((a,b)=>a+b,0)/pesos.length) }))
      .sort((a,b) => a.fecha.localeCompare(b.fecha));
  }

  const W = 700, H = 260, L = 52, R = 680, T = 24, Bot = 220;
  const todosAgrupados = [...agrupar('rucula'), ...agrupar('lechuga')];
  const pesos = todosAgrupados.map(p => p.peso_gr);
  const minP = Math.floor(Math.min(...pesos) * 0.9);
  const maxP = Math.ceil(Math.max(...pesos) * 1.1);
  const fechas = [...new Set(todosAgrupados.map(p => p.fecha))].sort();
  const xOf = (f: string) => fechas.length < 2
    ? (L + R) / 2
    : L + ((fechas.indexOf(f) / (fechas.length - 1)) * (R - L));
  const yOf = (v: number) => Bot - ((v - minP) / (maxP - minP || 1)) * (Bot - T);

  function pathFor(cultivo: string) {
    const pts = agrupar(cultivo);
    if (!pts.length) return { path: '', circles: [] as typeof pts };
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.fecha)} ${yOf(p.peso_gr)}`).join(' ');
    return { path, circles: pts };
  }

  const yTicks = 4;
  const tickStep = (maxP - minP) / yTicks;

  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {CULTIVOS.map(c => {
          const pts = agrupar(c.key);
          if (!pts.length) return null;
          const ultimo = pts[pts.length - 1];
          return (
            <div key={c.key} style={{ background: c.bg, border: `1px solid ${c.color}30`, borderRadius: '8px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: c.color }} />
              <div>
                <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>{c.label} — último</p>
                <p style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: c.color }}>{ultimo.peso_gr} g/paq</p>
                <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af' }}>{fmtLabel(ultimo.fecha)}</p>
              </div>
            </div>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Grid */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = Math.round(minP + i * tickStep);
          const y = yOf(v);
          return (
            <g key={i}>
              <line x1={L} y1={y} x2={R} y2={y} stroke="#f3f4f6" strokeWidth={1} />
              <text x={L - 4} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{v}g</text>
            </g>
          );
        })}
        {/* X axis dates */}
        {fechas.filter((_, i) => i % Math.max(1, Math.floor(fechas.length / 6)) === 0).map(f => (
          <text key={f} x={xOf(f)} y={Bot + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">
            {fmtLabel(f)}
          </text>
        ))}
        {/* Lines per cultivo */}
        {CULTIVOS.map(c => {
          const { path, circles } = pathFor(c.key);
          if (!path) return null;
          return (
            <g key={c.key}>
              <path d={path} fill="none" stroke={c.color} strokeWidth={2} strokeLinejoin="round" />
              {circles.map((p, i) => (
                <g key={i}>
                  <circle cx={xOf(p.fecha)} cy={yOf(p.peso_gr)} r={4} fill={c.color} />
                  <text x={xOf(p.fecha)} y={yOf(p.peso_gr) - 7} textAnchor="middle" fontSize={9} fill={c.color} fontWeight="bold">
                    {p.peso_gr}g
                  </text>
                </g>
              ))}
            </g>
          );
        })}
        <line x1={L} y1={Bot} x2={R} y2={Bot} stroke="#e5e7eb" strokeWidth={1} />
      </svg>
    </div>
  );
}
