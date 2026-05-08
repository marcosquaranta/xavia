import Link from 'next/link';
import { calcularDiasPorFase, claseVariedad, estimarPlantasActuales, naveDeLote } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
const COL: Record<string, { bg: string; text: string; label: string }> = {
  lechuga: { bg: '#4d7c0f', text: 'white', label: 'LECHUGA' },
  rucula: { bg: '#166534', text: 'white', label: 'RÚCULA' },
  albahaca: { bg: '#047857', text: 'white', label: 'ALBAHACA' },
};
function tipo(v: string): 'lechuga' | 'rucula' | 'albahaca' {
  const vl = v.toLowerCase();
  if (vl.includes('rucula') || vl.includes('rúcula')) return 'rucula';
  if (vl.includes('albahaca')) return 'albahaca';
  return 'lechuga';
}
function fmt(f: string): string {
  if (!f) return '-';
  try { const [, m, d] = String(f).split('-'); return d + '/' + m; } catch { return f; }
}
export default function LoteCard({ lote, movimientos, ubicaciones, variedades }: { lote: Lote; movimientos: Movimiento[]; ubicaciones: Ubicacion[]; variedades: Variedad[] }) {
  let dias: any;
  try { dias = calcularDiasPorFase(lote, movimientos); }
  catch { dias = { plantinera: 0, fase_1: null, fase_2: 0, total: 0, fechas: { siembra: '', fase_1_inicio: null, fase_2_inicio: null, cosecha: null } }; }
  const plantas = estimarPlantasActuales(lote, ubicaciones);
  const nave = naveDeLote(lote.id_lote);
  const varDef = variedades.find((v) => v.variedad === lote.variedad);
  const t = tipo(lote.variedad); const col = COL[t];
  const ubic = String(lote.ubicacion_actual || '');
  const mesada = ubic.replace(/^Nave \d+ - /, '');
  const labelFase = lote.fase_actual === 'plantin' ? 'Plantinera' : lote.fase_actual === 'fase_1' ? 'Fase 1' : 'Fase 2';
  const claseFase = lote.fase_actual === 'plantin' ? 'plantin' : lote.fase_actual === 'fase_1' ? 'fase1' : 'fase2';
  let accionLabel = 'Trasplantar'; let accionHref = '/cultivos/' + encodeURIComponent(lote.id_lote) + '/trasplantar';
  if (lote.fase_actual === 'fase_2') { accionLabel = 'Cosechar'; accionHref = '/cultivos/' + encodeURIComponent(lote.id_lote) + '/cosechar'; }
  else if (lote.fase_actual === 'fase_1') accionLabel = 'Pasar a F2';
  return (
    <div className={'lote-row ' + claseVariedad(lote)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <span style={{ background: col.bg, color: col.text, padding: '3px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 800, letterSpacing: '0.8px' }}>{col.label}</span>
            {lote.variedad.toLowerCase().includes('crespa') && <span style={{ fontSize: '11px', color: '#6b7280' }}>Crespa</span>}
            {lote.variedad.toLowerCase().includes('roble') && <span style={{ fontSize: '11px', color: '#6b7280' }}>Hoja de Roble</span>}
            {nave && <span style={{ background: nave === 1 ? '#1e40af' : '#7c3aed', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>Nave {nave}</span>}
            {mesada && <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151', background: '#f3f4f6', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e5e7eb' }}>{mesada}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className={'pill ' + claseFase}>{labelFase}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#9ca3af' }}>Nro Lote: {lote.id_lote}</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>
            {plantas > 0 ? '~' + plantas + ' plantas' : (lote.plantines_iniciales || 0) + ' plantines'}
            {' · '}<strong>{dias.total}d</strong> desde siembra
            {varDef && <span style={{ color: '#9ca3af' }}> · ciclo est. {varDef.dias_estimados_cosecha}d</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {lote.estado === 'activo' && <Link href={accionHref} className="btn small">{accionLabel}</Link>}
          <Link href={'/cultivos/' + encodeURIComponent(lote.id_lote)} className="btn secondary small">Ver</Link>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '12px', fontSize: '11px', paddingTop: '8px', borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: '8px', flexWrap: 'wrap' }}>
        <span><span style={{ color: '#6b7280' }}>Sembrado:</span> {fmt(dias.fechas.siembra)}</span>
        <span><span style={{ color: '#6b7280' }}>Plantinera:</span> <strong>{dias.plantinera}d</strong></span>
        {dias.fase_1 !== null && <span><span style={{ color: '#6b7280' }}>F1:</span> <strong>{dias.fase_1}d</strong></span>}
        {dias.fase_2 > 0 && <span><span style={{ color: '#6b7280' }}>F2:</span> <strong>{dias.fase_2}d</strong></span>}
      </div>
    </div>
  );
}