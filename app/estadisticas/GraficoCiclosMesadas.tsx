'use client';

interface CicloMesada {
  nombre: string; nave: number;
  lechugaF1: number; lechugaF2: number; lechugaTotal: number; lechugaN: number;
  ruculaF2: number; ruculaTotal: number; ruculaN: number;
}

export default function GraficoCiclosMesadas({ datos }: { datos: CicloMesada[] }) {
  if (!datos.length) return null;
  const maxV = Math.max(...datos.flatMap(d => [d.lechugaTotal, d.ruculaF2]), 1);
  const W = 640, H = 220, PL = 40, PR = 12, PT = 20, PB = 50;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const slotW = chartW / datos.length;
  const barW = Math.min(24, slotW * 0.32);
  const gap = barW * 0.3;
  const baseY = PT + chartH;
  function ph(d: number) { return (d / maxV) * chartH; }
  function xL(i: number) { return PL + i * slotW + slotW/2 - gap/2 - barW; }
  function xR(i: number) { return PL + i * slotW + slotW/2 + gap/2; }
  const yRefs = [0, Math.round(maxV * 0.5), maxV];

  return (
    <div>
      <div style={{ display:'flex', gap:'14px', fontSize:'11px', marginBottom:'8px', flexWrap:'wrap' }}>
        <span style={{ display:'flex', alignItems:'center', gap:'4px' }}>
          <span style={{ width:10, height:10, background:'#86efac', borderRadius:2, display:'inline-block' }}/> Lech F1
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:'4px' }}>
          <span style={{ width:10, height:10, background:'#4d7c0f', borderRadius:2, display:'inline-block' }}/> Lech F2
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:'4px' }}>
          <span style={{ width:10, height:10, background:'#166534', borderRadius:2, display:'inline-block' }}/> Rúcula F2
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto' }}>
        {yRefs.map((v,i) => (
          <g key={i}>
            <line x1={PL} x2={W-PR} y1={baseY-ph(v)} y2={baseY-ph(v)} stroke="#f0f0f0" strokeWidth={1}/>
            <text x={PL-4} y={baseY-ph(v)+4} textAnchor="end" fontSize={9} fill="#9ca3af">{v}d</text>
          </g>
        ))}
        <line x1={PL} x2={W-PR} y1={baseY} y2={baseY} stroke="#e5e7eb" strokeWidth={1}/>
        {datos.map((d, i) => {
          const hF1 = ph(d.lechugaF1); const hF2 = ph(d.lechugaF2); const hR = ph(d.ruculaF2);
          return (
            <g key={i}>
              {/* Lechuga: F2 abajo, F1 arriba */}
              {hF2 > 0 && <rect x={xL(i)} y={baseY-hF2} width={barW} height={hF2} fill="#4d7c0f" rx={2}/>}
              {hF1 > 0 && <rect x={xL(i)} y={baseY-hF2-hF1} width={barW} height={hF1} fill="#86efac" rx={2}/>}
              {d.lechugaTotal > 0 && <text x={xL(i)+barW/2} y={baseY-hF2-hF1-3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={500}>{d.lechugaTotal}d</text>}
              {/* Rúcula */}
              {hR > 0 && <rect x={xR(i)} y={baseY-hR} width={barW} height={hR} fill="#166534" rx={2}/>}
              {hR > 0 && <text x={xR(i)+barW/2} y={baseY-hR-3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={500}>{d.ruculaF2}d</text>}
              {/* Badge nave */}
              <rect x={PL+i*slotW+slotW/2-10} y={baseY+6} width={20} height={10} rx={2} fill={d.nave===1?'#881337':'#7c3aed'}/>
              <text x={PL+i*slotW+slotW/2} y={baseY+14} textAnchor="middle" fontSize={7} fill="white" fontWeight={700}>N{d.nave}</text>
              {/* Nombre mesada */}
              <text x={PL+i*slotW+slotW/2} y={baseY+32} textAnchor="middle" fontSize={8} fill="#6b7280" transform={`rotate(-35,${PL+i*slotW+slotW/2},${baseY+32})`}>
                {d.nombre.length > 12 ? d.nombre.slice(0,12)+'…' : d.nombre}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
