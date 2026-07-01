import Link from 'next/link';
import type { GrupoLotes } from '@/lib/planificacionServer';

// Rojo = ya atrasado (días > estimado) · Ámbar = justo hoy · Gris = normal, en margen
function colorItem(dias: number, est: number) {
  const faltan = est - dias;
  if (faltan < 0) return '#dc2626';
  if (faltan === 0) return '#d97706';
  return '#374151';
}

export default function GruposLotes({ grupos, icono, etiqueta }: { grupos: GrupoLotes[]; icono: string; etiqueta: string }) {
  if (!grupos.length) return null;
  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>{icono} {etiqueta}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {grupos.map((g, i) => (
          <div key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '12.5px' }}>
              <span style={{ background: g.nave === 1 ? '#881337' : '#7c3aed', color: 'white', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 700 }}>N{g.nave}</span>
              <strong style={{ color: '#374151' }}>{g.mesada}</strong>
              <span style={{ color: '#9ca3af' }}>· {g.titulo}</span>
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
        ))}
      </div>
    </div>
  );
}
