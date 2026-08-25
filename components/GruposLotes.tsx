import Link from 'next/link';
import type { GrupoLotes } from '@/lib/planificacionServer';

// Estos lotes ya están listos para trasplantar/cosechar (dias >= est), así que el color
// marca CUÁNTO tiempo pasó desde que quedaron listos, de negro (recién) a rojo (muy
// atrasado) — usa la proporción dias/est para que escale igual en ciclos cortos
// (rúcula) y largos (lechuga), en vez de un umbral fijo de días.
function colorItem(dias: number, est: number) {
  if (est <= 0) return '#111827';
  const ratio = dias / est;
  if (ratio > 1.3) return '#dc2626';   // rojo — muy atrasado
  if (ratio > 1.15) return '#d97706';  // amarillo — atrasándose
  return '#111827';                    // negro — recién listo
}

// Estilo por tipo de transición — para que las dos etapas de trasplante (que tienen
// tiempos muy distintos) se distingan de un vistazo, no solo con texto chico.
const TITULO_STYLE: Record<string, { color: string; bg: string; icon: string }> = {
  'Plantinera → Fase 1': { color: '#0369a1', bg: '#e0f2fe', icon: '🌱' },
  'Fase 1 → Fase 2': { color: '#7c3aed', bg: '#f3e8ff', icon: '🪴' },
};
const ORDEN_TITULOS = ['Plantinera → Fase 1', 'Fase 1 → Fase 2'];
function estiloTitulo(titulo: string) {
  return TITULO_STYLE[titulo] || { color: '#166534', bg: '#dcfce7', icon: '🌾' };
}

// Mismos colores que en Planificación (rúcula/lechuga), para que el cultivo se
// distinga siempre — muchas mesadas (ej. "Plantinera") comparten nombre entre
// cultivos, así que no alcanza con el nombre de mesada para diferenciarlos.
function estiloCultivo(cultivo: 'rucula' | 'lechuga') {
  return cultivo === 'rucula'
    ? { color: '#92400e', bg: '#fef3c7', label: 'Rúcula' }
    : { color: '#166534', bg: '#dcfce7', label: 'Lechuga' };
}

export default function GruposLotes({ grupos, icono, etiqueta }: { grupos: GrupoLotes[]; icono: string; etiqueta: string }) {
  if (!grupos.length) return null;

  const porTitulo = new Map<string, GrupoLotes[]>();
  for (const g of grupos) {
    if (!porTitulo.has(g.titulo)) porTitulo.set(g.titulo, []);
    porTitulo.get(g.titulo)!.push(g);
  }
  const titulos = Array.from(porTitulo.keys()).sort((a, b) => {
    const ia = ORDEN_TITULOS.indexOf(a), ib = ORDEN_TITULOS.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return (
    <div>
      <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>{icono} {etiqueta}</p>
      {/* Grid en vez de columna única — con pocos lotes listos, una sola columna angosta
          dejaba mucho espacio vacío a la derecha en pantallas anchas; así las secciones
          (y las mesadas dentro de cada una) se acomodan una al lado de la otra cuando entran. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', alignItems: 'start' }}>
        {titulos.map(titulo => {
          const st = estiloTitulo(titulo);
          const gs = porTitulo.get(titulo)!;
          // La mesada de origen (ej. "Plantinera") ya está en el título de la sección
          // (ej. "Plantinera → Fase 1") — no repetirla en cada fila si es igual.
          const deLabel = titulo.split(' → ')[0]?.trim().toLowerCase();
          return (
            <div key={titulo}>
              <p style={{ margin: '0 0 7px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 800, color: st.color, background: st.bg, borderRadius: '5px', padding: '3px 10px' }}>
                {st.icon} {titulo}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px', paddingLeft: '2px' }}>
                {gs.map((g, i) => {
                  const c = estiloCultivo(g.cultivo);
                  const mesadaEsRedundante = g.mesada.trim().toLowerCase() === deLabel;
                  return (
                  <div key={i}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '12.5px' }}>
                      <span style={{ background: g.nave === 1 ? '#881337' : '#7c3aed', color: 'white', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 700 }}>N{g.nave}</span>
                      <span style={{ background: c.bg, color: c.color, padding: '1px 7px', borderRadius: '3px', fontSize: '10px', fontWeight: 700 }}>{c.label}</span>
                      {!mesadaEsRedundante && <strong style={{ color: '#374151' }}>{g.mesada}</strong>}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', paddingLeft: '4px' }}>
                      {g.items.map(it => (
                        <Link key={it.id} href={`/cultivos/${encodeURIComponent(it.id)}`} style={{ textDecoration: 'none' }}>
                          <span style={{
                            fontFamily: 'monospace', fontWeight: 700, fontSize: '11.5px', color: colorItem(it.dias, it.est),
                            background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '5px', padding: '2px 7px', display: 'inline-block',
                          }}>
                            {it.id} <span style={{ fontWeight: 400, color: '#9ca3af' }}>({it.dias}d)</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
