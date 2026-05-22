import Link from 'next/link';
import type { FiltroCultivo, FiltroFase, FiltroNave, ConteosFiltros } from '@/lib/lotes';

interface Props {
  cultivoActivo: FiltroCultivo;
  faseActiva: FiltroFase;
  naveActiva: FiltroNave;
  conteos: ConteosFiltros;
  baseUrl: string;
}

export default function FiltrosLotes({ cultivoActivo, faseActiva, naveActiva, conteos, baseUrl }: Props) {
  function url(c: string, f: string, n: string) {
    const p = new URLSearchParams();
    if (c !== 'todos') p.set('cultivo', c);
    if (f !== 'todas') p.set('fase', f);
    if (n !== 'todas') p.set('nave', n);
    const s = p.toString();
    return `${baseUrl}${s ? '?' + s : ''}`;
  }

  function pill(active: boolean, bg: string, bgOff = '#f3f4f6', cOff = '#374151'): React.CSSProperties {
    return { background: active ? bg : bgOff, color: active ? 'white' : cOff, border: '1px solid ' + (active ? bg : '#e5e7eb'), cursor: 'pointer' };
  }

  return (
    <div style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>

      {/* Fila 1: Cultivo */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', minWidth: '52px' }}>Cultivo</span>
        <Link href={url('todos', faseActiva, naveActiva)} style={{ textDecoration: 'none' }}>
          <span className="pill" style={pill(cultivoActivo === 'todos', '#059669')}>Todos ({conteos.todos})</span>
        </Link>
        <Link href={url('lechuga', faseActiva, naveActiva)} style={{ textDecoration: 'none' }}>
          <span className="pill" style={pill(cultivoActivo === 'lechuga', '#4d7c0f', '#f7fee7', '#4d7c0f')}>Lechuga ({conteos.lechuga})</span>
        </Link>
        <Link href={url('rucula', faseActiva, naveActiva)} style={{ textDecoration: 'none' }}>
          <span className="pill" style={pill(cultivoActivo === 'rucula', '#166534', '#dcfce7', '#166534')}>Rúcula ({conteos.rucula})</span>
        </Link>
        {conteos.albahaca > 0 && (
          <Link href={url('albahaca', faseActiva, naveActiva)} style={{ textDecoration: 'none' }}>
            <span className="pill" style={pill(cultivoActivo === 'albahaca', '#047857', '#d1fae5', '#047857')}>Albahaca ({conteos.albahaca})</span>
          </Link>
        )}
      </div>

      {/* Fila 2: Fase */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', minWidth: '52px' }}>Fase</span>
        {[
          { key: 'todas', label: 'Todas' },
          { key: 'plantinera', label: `Plantinera (${conteos.plantinera})` },
          { key: 'fase_1', label: `F1 (${conteos.fase_1})` },
          { key: 'fase_2', label: `F2 (${conteos.fase_2})` },
          { key: 'cosechados', label: `Cosechados (${conteos.cosechados})` },
        ].map((f) => (
          <Link key={f.key} href={url(cultivoActivo, f.key, naveActiva)} style={{ textDecoration: 'none' }}>
            <span className="pill" style={pill(faseActiva === f.key, '#4b5563', 'white', '#4b5563')}>{f.label}</span>
          </Link>
        ))}
      </div>

      {/* Fila 3: Nave */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', minWidth: '52px' }}>Nave</span>
        <Link href={url(cultivoActivo, faseActiva, 'todas')} style={{ textDecoration: 'none' }}>
          <span className="pill" style={pill(naveActiva === 'todas', '#111827', '#f9fafb')}>Ambas</span>
        </Link>
        <Link href={url(cultivoActivo, faseActiva, '1')} style={{ textDecoration: 'none' }}>
          <span className="pill" style={pill(naveActiva === '1', '#1e40af', '#eff6ff', '#1e40af')}>Nave 1</span>
        </Link>
        <Link href={url(cultivoActivo, faseActiva, '2')} style={{ textDecoration: 'none' }}>
          <span className="pill" style={pill(naveActiva === '2', '#7c3aed', '#f5f3ff', '#7c3aed')}>Nave 2</span>
        </Link>
      </div>

    </div>
  );
}
