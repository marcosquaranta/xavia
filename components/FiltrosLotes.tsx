import Link from 'next/link';
import type { FiltroCultivo, FiltroFase, FiltroNave, FiltroTiempo, ConteosFiltros } from '@/lib/lotes';
import type { Ubicacion } from '@/lib/types';

interface Props {
  cultivoActivo: FiltroCultivo;
  faseActiva: FiltroFase;
  naveActiva: FiltroNave;
  mesadaActiva: string;
  tiempoActivo?: FiltroTiempo;
  conteos: ConteosFiltros;
  ubicaciones: Ubicacion[];
  baseUrl: string;
  esAdmin?: boolean;
}

export default function FiltrosLotes({ cultivoActivo, faseActiva, naveActiva, mesadaActiva, tiempoActivo = 'todos', conteos, ubicaciones, baseUrl, esAdmin = false }: Props) {
  function url(c: string, f: string, n: string, m: string, t = 'todos') {
    const p = new URLSearchParams();
    if (c !== 'todos') p.set('cultivo', c);
    if (f !== 'todas') p.set('fase', f);
    if (n !== 'todas') p.set('nave', n);
    if (m && m !== 'todas') p.set('mesada', m);
    if (t && t !== 'todos') p.set('tiempo', t);
    const s = p.toString();
    return `${baseUrl}${s ? '?' + s : ''}`;
  }

  function pill(active: boolean, bg: string, bgOff = '#f3f4f6', cOff = '#374151'): React.CSSProperties {
    return { background: active ? bg : bgOff, color: active ? 'white' : cOff, border: '1px solid ' + (active ? bg : '#e5e7eb'), cursor: 'pointer' };
  }

  // Mesadas filtradas por nave Y por cultivo seleccionado
  const mesadas = ubicaciones
    .filter((u) => {
      if (u.tipo !== 'mesada' || u.activo !== 'SI') return false;
      if (naveActiva !== 'todas' && String(u.nave) !== naveActiva) return false;
      // Filtrar mesadas según cultivo seleccionado
      if (cultivoActivo === 'lechuga') {
        const n = u.nombre.toLowerCase();
        return n.includes('lechuga') || (!n.includes('rucula') && !n.includes('rúcula') && !n.includes('albahaca'));
      }
      if (cultivoActivo === 'rucula') {
        const n = u.nombre.toLowerCase();
        return n.includes('rucula') || n.includes('rúcula');
      }
      if (cultivoActivo === 'albahaca') {
        const n = u.nombre.toLowerCase();
        return n.includes('albahaca');
      }
      return true;
    })
    .sort((a, b) => Number(a.orden_visual) - Number(b.orden_visual));

  // Fases disponibles según cultivo
  const tieneF1 = cultivoActivo !== 'rucula';
  // Si fase activa no aplica al cultivo, resetear al cambiar cultivo
  const faseValidada = (!tieneF1 && faseActiva === 'fase_1') ? 'todas' : faseActiva;

  return (
    <div style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>

      {/* Fila 1: Cultivo */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', minWidth: '52px' }}>Cultivo</span>
        <Link href={url('todos', faseActiva, naveActiva, mesadaActiva)} style={{ textDecoration: 'none' }}>
          <span className="pill" style={pill(cultivoActivo === 'todos', '#059669')}>Todos ({conteos.todos})</span>
        </Link>
        <Link href={url('lechuga', faseActiva, naveActiva, 'todas')} style={{ textDecoration: 'none' }}>
          <span className="pill" style={pill(cultivoActivo === 'lechuga', '#4d7c0f', '#f7fee7', '#4d7c0f')}>Lechuga ({conteos.lechuga})</span>
        </Link>
        <Link href={url('rucula', 'todas', naveActiva, 'todas')} style={{ textDecoration: 'none' }}>
          <span className="pill" style={pill(cultivoActivo === 'rucula', '#166534', '#dcfce7', '#166534')}>Rúcula ({conteos.rucula})</span>
        </Link>
        {conteos.albahaca > 0 && (
          <Link href={url('albahaca', faseActiva, naveActiva, 'todas')} style={{ textDecoration: 'none' }}>
            <span className="pill" style={pill(cultivoActivo === 'albahaca', '#047857', '#d1fae5', '#047857')}>Albahaca ({conteos.albahaca})</span>
          </Link>
        )}
      </div>

      {/* Fila 2: Fase — sin F1 para rúcula */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', minWidth: '52px' }}>Fase</span>
        {[
          { key: 'todas', label: 'Todas', show: true },
          { key: 'plantinera', label: `Plantinera (${conteos.plantinera})`, show: true },
          { key: 'fase_1', label: `F1 (${conteos.fase_1})`, show: tieneF1 },
          { key: 'fase_2', label: `F2 (${conteos.fase_2})`, show: true },
          { key: 'cosechados', label: `Cosechados (${conteos.cosechados})`, show: true },
        ].filter(f => f.show).map((f) => (
          <Link key={f.key} href={url(cultivoActivo, f.key, naveActiva, mesadaActiva)} style={{ textDecoration: 'none' }}>
            <span className="pill" style={pill(faseValidada === f.key, '#4b5563', 'white', '#4b5563')}>{f.label}</span>
          </Link>
        ))}
        {esAdmin && (
          <Link href={url(cultivoActivo, 'borrados', naveActiva, mesadaActiva)} style={{ textDecoration: 'none' }}>
            <span className="pill" style={pill(faseValidada === 'borrados', '#b91c1c', '#fef2f2', '#b91c1c')}>🗑 Borrados ({conteos.borrados})</span>
          </Link>
        )}
      </div>

      {/* Fila 3: Nave */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', minWidth: '52px' }}>Nave</span>
        {[
          { key: 'todas', label: 'Ambas', bg: '#111827', bgI: '#f9fafb', c: '#374151' },
          { key: '1', label: 'Nave 1', bg: '#881337', bgI: '#fff1f2', c: '#881337' },
          { key: '2', label: 'Nave 2', bg: '#7c3aed', bgI: '#f5f3ff', c: '#7c3aed' },
        ].map((n) => (
          <Link key={n.key} href={url(cultivoActivo, faseValidada, n.key, n.key !== naveActiva ? 'todas' : mesadaActiva)} style={{ textDecoration: 'none' }}>
            <span className="pill" style={pill(naveActiva === n.key, n.bg, n.bgI, n.c)}>{n.label}</span>
          </Link>
        ))}
      </div>

      {/* Fila 4: Mesada — filtrada por cultivo */}
      {mesadas.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', minWidth: '52px' }}>Mesada</span>
          <Link href={url(cultivoActivo, faseValidada, naveActiva, 'todas')} style={{ textDecoration: 'none' }}>
            <span className="pill" style={pill(!mesadaActiva || mesadaActiva === 'todas', '#374151', '#f3f4f6', '#374151')}>Todas</span>
          </Link>
          {mesadas.map((m) => {
            const label = m.nombre.replace(/^Nave \d+ - /, '');
            return (
              <Link key={m.id_ubicacion} href={url(cultivoActivo, faseValidada, naveActiva, m.nombre)} style={{ textDecoration: 'none' }}>
                <span className="pill" style={pill(mesadaActiva === m.nombre, '#374151', '#f3f4f6', '#374151')} title={m.nombre}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Fila 5: Tiempo — solo para cosechados */}
      {faseValidada === 'cosechados' && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', minWidth: '52px' }}>Período</span>
          {[
            { key: 'todos', label: 'Todos' },
            { key: '7d', label: 'Últimos 7 días' },
            { key: '30d', label: 'Último mes' },
            { key: '90d', label: 'Últimos 3 meses' },
          ].map((t) => (
            <Link key={t.key} href={url(cultivoActivo, faseValidada, naveActiva, mesadaActiva, t.key)} style={{ textDecoration: 'none' }}>
              <span className="pill" style={pill(tiempoActivo === t.key, '#374151', 'white', '#374151')}>{t.label}</span>
            </Link>
          ))}
        </div>
      )}

    </div>
  );
}
