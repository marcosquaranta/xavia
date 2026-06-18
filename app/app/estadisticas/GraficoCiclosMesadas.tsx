'use client';

interface CicloMesada {
  nombre: string; nave: number;
  lechugaF1: number; lechugaF2: number; lechugaTotal: number; lechugaN: number;
  ruculaF2: number; ruculaTotal: number; ruculaN: number;
  pesoGrLechuga: number; pesoGrRucula: number;
}

const NAVE_FILL: Record<number, string> = { 1: '#881337', 2: '#7c3aed' };

function SubGrafico({
  titulo, datos, f1Color, f2Color, pesoKey, totalKey, f2Key, f1Key,
}: {
  titulo: string;
  datos: CicloMesada[];
  f1Color?: string;
  f2Color: string;
  pesoKey: 'pesoGrLechuga' | 'pesoGrRucula';
  totalKey: 'lechugaTotal' | 'ruculaTotal';
  f2Key: 'lechugaF2' | 'ruculaF2';
  f1Key?: 'lechugaF1';
}) {
  if (!datos.length) return null;

  const W = 640, H = 230, PL = 40, PR = 46, PT = 28, PB = 58;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const baseY = PT + chartH;

  const maxDias = Math.max(...datos.map(d => d[totalKey] || 0), 1);
  const pesoPuntos = datos.map((d, i) => ({ i, gr: d[pesoKey] })).filter(p => p.gr > 0);
  const maxPeso = pesoPuntos.length ? Math.max(...pesoPuntos.map(p => p.gr), 1) : 1;
  const pesoMax = Math.ceil(maxPeso / 50) * 50;

  const slotW = chartW / datos.length;
  const barW = Math.min(36, slotW * 0.58);

  function yD(d: number) { return baseY - (d / maxDias) * chartH; }
  function yP(g: number) { return baseY - (g / pesoMax) * chartH; }
  function xC(i: number) { return PL + i * slotW + slotW / 2; }

  const ticksDias = [0, Math.round(maxDias / 2), maxDias];
  const ticksPeso = [0, Math.round(pesoMax / 2), pesoMax];

  return (
    <div style={{ marginBottom: '20px' }}>
      <p style={{ margin: '0 0 4px', fontSize: '12px', fontWeight: 700, color: '#374151' }}>{titulo}</p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>

        {/* Grid + eje Y izquierdo */}
        {ticksDias.map((v, idx) => (
          <g key={idx}>
            <line x1={PL} x2={W - PR} y1={yD(v)} y2={yD(v)} stroke={idx === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth={1} />
            <text x={PL - 4} y={yD(v) + 4} textAnchor="end" fontSize={9} fill="#6b7280">{v}d</text>
          </g>
        ))}

        {/* Eje Y derecho (peso) */}
        {pesoPuntos.length > 0 && (
          <>
            <line x1={W - PR} x2={W - PR} y1={PT} y2={baseY} stroke="#fed7aa" strokeWidth={1} strokeDasharray="3 2" />
            <text x={W - 4} y={PT - 8} textAnchor="end" fontSize={8} fill="#f97316" fontWeight={600}>peso →</text>
            {ticksPeso.map((v, idx) => (
              <text key={idx} x={W - PR + 5} y={yP(v) + 4} textAnchor="start" fontSize={9} fill="#f97316">{v}g</text>
            ))}
          </>
        )}

        {/* Barras */}
        {datos.map((d, i) => {
          const total = d[totalKey];
          const f2 = d[f2Key];
          const f1 = f1Key ? d[f1Key] : 0;
          if (!total) return null;
          const x0 = xC(i) - barW / 2;
          return (
            <g key={i}>
              {f2 > 0 && <rect x={x0} y={yD(f2)} width={barW} height={(f2 / maxDias) * chartH} fill={f2Color} rx={2} />}
              {f1 > 0 && f1Key && <rect x={x0} y={yD(total)} width={barW} height={(f1 / maxDias) * chartH} fill={f1Color!} rx={2} />}
              <text x={xC(i)} y={yD(total) - 4} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={600}>{total}d</text>
              {/* Badge nave */}
              <rect x={xC(i) - 10} y={baseY + 6} width={20} height={11} rx={2} fill={NAVE_FILL[d.nave]} />
              <text x={xC(i)} y={baseY + 14.5} textAnchor="middle" fontSize={7} fill="white" fontWeight={700}>N{d.nave}</text>
              {/* Nombre mesada */}
              <text x={xC(i)} y={baseY + 26} textAnchor="end" fontSize={8} fill="#6b7280"
                transform={`rotate(-38,${xC(i)},${baseY + 26})`}>
                {d.nombre.length > 16 ? d.nombre.slice(0, 16) + '…' : d.nombre}
              </text>
            </g>
          );
        })}

        {/* Línea de peso */}
        {pesoPuntos.length > 1 && (
          <polyline
            points={pesoPuntos.map(p => `${xC(p.i)},${yP(p.gr)}`).join(' ')}
            fill="none" stroke="#fb923c" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.8}
          />
        )}
        {pesoPuntos.map(p => (
          <g key={p.i}>
            <circle cx={xC(p.i)} cy={yP(p.gr)} r={5} fill="#fb923c" stroke="white" strokeWidth={1.5} />
            <text x={xC(p.i)} y={yP(p.gr) - 8} textAnchor="middle" fontSize={8} fill="#ea580c" fontWeight={600}>{p.gr}g</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function GraficoCiclosMesadas({ datos }: { datos: CicloMesada[] }) {
  if (!datos.length) return null;
  const lechuga = datos.filter(d => d.lechugaTotal > 0);
  const rucula  = datos.filter(d => d.ruculaTotal  > 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', fontSize: '11px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 10, height: 10, background: '#86efac', borderRadius: 2, display: 'inline-block' }} /> Lechuga F1
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 10, height: 10, background: '#4d7c0f', borderRadius: 2, display: 'inline-block' }} /> Lechuga F2
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 10, height: 10, background: '#166534', borderRadius: 2, display: 'inline-block' }} /> Rúcula F2
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <svg width={10} height={10} style={{ display: 'inline-block' }}><circle cx={5} cy={5} r={4} fill="#fb923c" /></svg>
          Peso prom. gr/paq (eje der. →)
        </span>
      </div>
      <SubGrafico titulo="Lechuga — ciclos por mesada" datos={lechuga}
        f1Color="#86efac" f2Color="#4d7c0f"
        pesoKey="pesoGrLechuga" totalKey="lechugaTotal" f2Key="lechugaF2" f1Key="lechugaF1" />
      <SubGrafico titulo="Rúcula — ciclos por mesada" datos={rucula}
        f2Color="#166534"
        pesoKey="pesoGrRucula" totalKey="ruculaTotal" f2Key="ruculaF2" />
    </div>
  );
}
