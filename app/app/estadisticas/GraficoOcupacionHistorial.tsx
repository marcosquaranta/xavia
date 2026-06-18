'use client';

export interface DiaOcupacion {
  fecha: string;
  loteId: string | null;
  cultivo: 'lechuga' | 'rucula' | 'albahaca' | null;
}

export interface MesadaOcupacion {
  nombre: string;
  nave: number;
  dias: DiaOcupacion[];
}

const COLOR: Record<string, string> = {
  lechuga: '#86efac',
  rucula:  '#fdba74',
  albahaca:'#c4b5fd',
};

const NAVE_COLOR: Record<number, string> = { 1: '#881337', 2: '#7c3aed' };

export default function GraficoOcupacionHistorial({
  mesadas, fechas, nave,
}: {
  mesadas: MesadaOcupacion[];
  fechas: string[];
  nave: 1 | 2;
}) {
  const filas = mesadas.filter(m => m.nave === nave);

  if (!filas.length) return (
    <p style={{ color: '#9ca3af', fontSize: '13px', padding: '8px 0' }}>Sin mesadas activas en Nave {nave}.</p>
  );

  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 700, color: NAVE_COLOR[nave], textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Nave {nave}
      </p>

      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Etiquetas Y */}
        <div style={{ flexShrink: 0, width: '110px', paddingRight: '6px' }}>
          <div style={{ height: '22px' }} />
          {filas.map(m => (
            <div key={m.nombre} style={{
              height: '20px', display: 'flex', alignItems: 'center',
              fontSize: '10px', color: '#374151', fontWeight: 500,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {m.nombre}
            </div>
          ))}
        </div>

        {/* Grilla */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Eje X */}
          <div style={{ display: 'flex', height: '22px', alignItems: 'flex-end', borderBottom: '1px solid #e5e7eb' }}>
            {fechas.map((f, i) => {
              const d = new Date(f + 'T12:00:00');
              const esLunes = d.getDay() === 1;
              const esPrimero = d.getDate() === 1;
              return (
                <div key={i} style={{
                  flex: 1, fontSize: '8px',
                  color: esPrimero ? '#374151' : '#9ca3af',
                  fontWeight: esPrimero ? 700 : 400,
                  textAlign: 'center', overflow: 'hidden',
                  borderLeft: (esLunes || esPrimero) ? '1px solid #e5e7eb' : 'none',
                  paddingBottom: '2px', lineHeight: 1,
                }}>
                  {(esLunes || esPrimero || i === 0) ? `${d.getDate()}/${d.getMonth() + 1}` : ''}
                </div>
              );
            })}
          </div>

          {/* Filas */}
          {filas.map((m, ri) => (
            <div key={m.nombre} style={{
              display: 'flex', height: '20px',
              borderBottom: ri < filas.length - 1 ? '1px solid #f3f4f6' : 'none',
            }}>
              {m.dias.map((dia, j) => {
                const d = new Date(dia.fecha + 'T12:00:00');
                const esFinde = d.getDay() === 0 || d.getDay() === 6;
                const esLunes = d.getDay() === 1;
                const bg = dia.cultivo ? COLOR[dia.cultivo] : esFinde ? '#f3f4f6' : 'white';
                return (
                  <div
                    key={j}
                    style={{
                      flex: 1, height: '100%', background: bg,
                      borderLeft: esLunes ? '1px solid #e5e7eb' : '1px solid rgba(0,0,0,0.04)',
                    }}
                    title={dia.cultivo
                      ? `${dia.fecha} · ${dia.cultivo}${dia.loteId ? ` · ${dia.loteId}` : ''}`
                      : `${dia.fecha} · libre`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Leyenda */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
        {Object.entries({ lechuga: 'Lechuga', rucula: 'Rúcula', albahaca: 'Albahaca' }).map(([k, l]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: COLOR[k], border: '1px solid rgba(0,0,0,0.08)' }} />
            <span style={{ fontSize: '10px', color: '#6b7280' }}>{l}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: 'white', border: '1px solid #e5e7eb' }} />
          <span style={{ fontSize: '10px', color: '#9ca3af' }}>Libre</span>
        </div>
      </div>
    </div>
  );
}
