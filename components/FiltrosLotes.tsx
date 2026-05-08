import Link from 'next/link';
import type { FiltroCultivos, FiltroNave, ConteosFiltros } from '@/lib/lotes';
interface Props { filtroActivo: string; naveActiva: FiltroNave; conteos: ConteosFiltros; baseUrl: string; }
export default function FiltrosLotes({ filtroActivo, naveActiva, conteos, baseUrl }: Props) {
  function buildUrl(f: string, n: string) {
    const p = new URLSearchParams();
    if (f !== 'todos') p.set('filtro', f);
    if (n !== 'todas') p.set('nave', n);
    const s = p.toString();
    return `${baseUrl}${s ? '?' + s : ''}`;
  }
  const tipoFiltros = [
    { key: 'todos', label: `Todos (${conteos.todos})`, color: 'verde' },
    { key: 'lechuga', label: `Lechuga (${conteos.lechuga})`, color: 'lechuga' },
    { key: 'rucula', label: `Rúcula (${conteos.rucula})`, color: 'rucula' },
    ...(conteos.albahaca > 0 ? [{ key: 'albahaca', label: `Albahaca (${conteos.albahaca})`, color: 'albahaca' }] : []),
    { key: 'cosechados', label: `Cosechados (${conteos.cosechados})`, color: 'gris' },
  ];
  const faseFiltros = [
    { key: 'plantinera', label: `Plantinera (${conteos.plantinera})` },
    { key: 'fase_1', label: `F1 (${conteos.fase_1})` },
    { key: 'fase_2', label: `F2 (${conteos.fase_2})` },
  ];
  const colores: Record<string, { active: string; normal: string }> = {
    verde: { active: '#059669', normal: '#f3f4f6' },
    lechuga: { active: '#4d7c0f', normal: '#f7fee7' },
    rucula: { active: '#166534', normal: '#dcfce7' },
    albahaca: { active: '#047857', normal: '#d1fae5' },
    gris: { active: '#374151', normal: '#f3f4f6' },
  };
  function pillStyle(active: boolean, color: string): React.CSSProperties {
    const c = colores[color] || colores.verde;
    return { background: active ? c.active : c.normal, color: active ? 'white' : '#374151', border: '1px solid ' + (active ? c.active : '#e5e7eb'), cursor: 'pointer' };
  }
  function faseStyle(active: boolean): React.CSSProperties {
    return { background: active ? '#4b5563' : 'white', color: active ? 'white' : '#4b5563', border: '1px solid ' + (active ? '#4b5563' : '#d1d5db'), cursor: 'pointer' };
  }
  function naveStyle(active: boolean, nave: string): React.CSSProperties {
    const bg = nave === '1' ? '#1e40af' : nave === '2' ? '#7c3aed' : '#111827';
    return { background: active ? bg : '#f9fafb', color: active ? 'white' : '#374151', border: '1px solid ' + (active ? bg : '#e5e7eb'), cursor: 'pointer' };
  }
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
        {tipoFiltros.map((f) => (
          <Link key={f.key} href={buildUrl(f.key, naveActiva)} style={{ textDecoration: 'none' }}>
            <span className="pill" style={pillStyle(filtroActivo === f.key, f.color)}>{f.label}</span>
          </Link>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {faseFiltros.map((f) => (
          <Link key={f.key} href={buildUrl(f.key, naveActiva)} style={{ textDecoration: 'none' }}>
            <span className="pill" style={faseStyle(filtroActivo === f.key)}>{f.label}</span>
          </Link>
        ))}
        <span style={{ color: '#d1d5db', lineHeight: '26px', padding: '0 4px' }}>|</span>
        {(['todas', '1', '2'] as FiltroNave[]).map((n) => (
          <Link key={n} href={buildUrl(filtroActivo, n)} style={{ textDecoration: 'none' }}>
            <span className="pill" style={naveStyle(naveActiva === n, n)}>{n === 'todas' ? 'Ambas naves' : 'Nave ' + n}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}