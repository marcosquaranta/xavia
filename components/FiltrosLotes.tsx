// components/FiltrosLotes.tsx
// Barra de filtros reutilizable: tipo de planta + fase + nave.
// Funciona como links que modifican los searchParams de la URL.

import Link from 'next/link';
import type { FiltroCultivos, FiltroNave } from '@/lib/lotes';

export interface ConteosFiltros {
  todos: number;
  lechuga: number;
  rucula: number;
  albahaca: number;
  plantinera: number;
  fase_1: number;
  fase_2: number;
  cosechados: number;
}

interface FiltrosLotesProps {
  filtroActivo: string;
  naveActiva: FiltroNave;
  conteos: ConteosFiltros;
  baseUrl: string; // ej: '/panel' o '/cultivos'
}

export default function FiltrosLotes({
  filtroActivo,
  naveActiva,
  conteos,
  baseUrl,
}: FiltrosLotesProps) {
  function buildUrl(nuevoFiltro: string, nuevaNave: string) {
    const params = new URLSearchParams();
    if (nuevoFiltro !== 'todos') params.set('filtro', nuevoFiltro);
    if (nuevaNave !== 'todas') params.set('nave', nuevaNave);
    const str = params.toString();
    return `${baseUrl}${str ? `?${str}` : ''}`;
  }

  return (
    <div style={{ marginBottom: '14px' }}>
      {/* Fila 1: Tipo de planta */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <Link href={buildUrl('todos', naveActiva)} style={{ textDecoration: 'none' }}>
          <Pill active={filtroActivo === 'todos'} color="verde">
            Todos ({conteos.todos})
          </Pill>
        </Link>
        <Link href={buildUrl('lechuga', naveActiva)} style={{ textDecoration: 'none' }}>
          <Pill active={filtroActivo === 'lechuga'} color="lechuga">
            Lechuga ({conteos.lechuga})
          </Pill>
        </Link>
        <Link href={buildUrl('rucula', naveActiva)} style={{ textDecoration: 'none' }}>
          <Pill active={filtroActivo === 'rucula'} color="rucula">
            Rúcula ({conteos.rucula})
          </Pill>
        </Link>
        {conteos.albahaca > 0 && (
          <Link href={buildUrl('albahaca', naveActiva)} style={{ textDecoration: 'none' }}>
            <Pill active={filtroActivo === 'albahaca'} color="albahaca">
              Albahaca ({conteos.albahaca})
            </Pill>
          </Link>
        )}
        <Link href={buildUrl('cosechados', naveActiva)} style={{ textDecoration: 'none' }}>
          <Pill active={filtroActivo === 'cosechados'} color="gris">
            Cosechados ({conteos.cosechados})
          </Pill>
        </Link>
      </div>

      {/* Fila 2: Fase + Nave */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {/* Fases */}
        {[
          { key: 'plantinera', label: `Plantinera (${conteos.plantinera})` },
          { key: 'fase_1', label: `F1 (${conteos.fase_1})` },
          { key: 'fase_2', label: `F2 (${conteos.fase_2})` },
        ].map((f) => (
          <Link key={f.key} href={buildUrl(f.key, naveActiva)} style={{ textDecoration: 'none' }}>
            <Pill active={filtroActivo === f.key} color="fase">
              {f.label}
            </Pill>
          </Link>
        ))}

        {/* Separador visual */}
        <span style={{ color: '#d1d5db', lineHeight: '26px', padding: '0 4px' }}>|</span>

        {/* Naves */}
        {(['todas', '1', '2'] as FiltroNave[]).map((n) => (
          <Link key={n} href={buildUrl(filtroActivo, n)} style={{ textDecoration: 'none' }}>
            <Pill active={naveActiva === n} color={n === '1' ? 'nave1' : n === '2' ? 'nave2' : 'nave0'}>
              {n === 'todas' ? 'Ambas naves' : `Nave ${n}`}
            </Pill>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Pill({
  active,
  color,
  children,
}: {
  active: boolean;
  color: string;
  children: React.ReactNode;
}) {
  const styles: Record<string, React.CSSProperties> = {
    verde: active
      ? { background: '#059669', color: 'white', border: '1px solid #059669' }
      : { background: 'white', color: '#374151', border: '1px solid #e5e7eb' },
    lechuga: active
      ? { background: '#4d7c0f', color: 'white', border: '1px solid #4d7c0f' }
      : { background: '#f7fee7', color: '#4d7c0f', border: '1px solid #bef264' },
    rucula: active
      ? { background: '#166534', color: 'white', border: '1px solid #166534' }
      : { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' },
    albahaca: active
      ? { background: '#047857', color: 'white', border: '1px solid #047857' }
      : { background: '#d1fae5', color: '#047857', border: '1px solid #6ee7b7' },
    gris: active
      ? { background: '#374151', color: 'white', border: '1px solid #374151' }
      : { background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' },
    fase: active
      ? { background: '#4b5563', color: 'white', border: '1px solid #4b5563' }
      : { background: 'white', color: '#4b5563', border: '1px solid #d1d5db' },
    nave0: active
      ? { background: '#111827', color: 'white', border: '1px solid #111827' }
      : { background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb' },
    nave1: active
      ? { background: '#1e40af', color: 'white', border: '1px solid #1e40af' }
      : { background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' },
    nave2: active
      ? { background: '#7c3aed', color: 'white', border: '1px solid #7c3aed' }
      : { background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe' },
  };

  return (
    <span
      className="pill"
      style={{
        cursor: 'pointer',
        ...(styles[color] || styles.verde),
      }}
    >
      {children}
    </span>
  );
}
