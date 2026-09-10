'use client';
import { useState } from 'react';
import Link from 'next/link';

// Actividad (antes su propia sección en el menú) ahora arranca acá arriba de Mis Cultivos,
// comprimida: de un vistazo se ve cuánto se movió la semana y, si hace falta el detalle,
// se despliega. El menú tenía demasiadas secciones y esto ya se miraba junto con los lotes.
// La página completa con filtros sigue existiendo en /movimientos, linkeada abajo.

export interface MovResumen {
  id: string;
  tipo: string;
  fecha: string;      // YYYY-MM-DD
  lote: string;
  variedad: string;
  esRucula: boolean;
  cantidad: string;
  usuario: string;
  ubicacion: string;
  fases: string;
  notas: string;
}

const TIPO_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  siembra:    { label: 'Siembra',    color: '#92400e', bg: '#fef9c3' },
  trasplante: { label: 'Trasplante', color: '#1e40af', bg: '#dbeafe' },
  cosecha:    { label: 'Cosecha',    color: '#166534', bg: '#dcfce7' },
  descarte:   { label: 'Descarte',   color: '#6b7280', bg: '#f3f4f6' },
  division:   { label: 'División',   color: '#7c3aed', bg: '#ede9fe' },
};

function fmtFecha(s: string) {
  const [y, m, d] = String(s || '').split('-');
  return d ? `${d}/${m}/${y}` : '—';
}
function diasAtras(s: string): string {
  try {
    const diff = Math.round((Date.now() - new Date(s + 'T12:00:00').getTime()) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    return `Hace ${diff}d`;
  } catch { return ''; }
}

export default function ActividadReciente({ movimientos, dias = 7 }: { movimientos: MovResumen[]; dias?: number }) {
  const [abierto, setAbierto] = useState(false);

  // Resumen por tipo — es lo que se ve sin desplegar, y suele alcanzar.
  const conteos = new Map<string, number>();
  for (const m of movimientos) conteos.set(m.tipo, (conteos.get(m.tipo) || 0) + 1);
  const resumen = ['siembra', 'trasplante', 'cosecha', 'division', 'descarte']
    .filter((t) => (conteos.get(t) || 0) > 0)
    .map((t) => ({ t, n: conteos.get(t)!, ...TIPO_LABEL[t] }));

  const porFecha = new Map<string, MovResumen[]>();
  for (const m of movimientos) {
    if (!porFecha.has(m.fecha)) porFecha.set(m.fecha, []);
    porFecha.get(m.fecha)!.push(m);
  }
  const fechas = [...porFecha.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>📋 Actividad reciente</span>
        <span style={{ fontSize: '11px', color: '#9ca3af' }}>últimos {dias} días</span>

        {resumen.length === 0 ? (
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>Sin movimientos.</span>
        ) : (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {resumen.map((r) => (
              <span key={r.t} style={{ background: r.bg, color: r.color, fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' }}>
                {r.n} {r.label.toLowerCase()}{r.n > 1 ? 's' : ''}
              </span>
            ))}
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Link href="/movimientos" style={{ fontSize: '11px', color: '#6b7280', textDecoration: 'none' }}>Ver con filtros →</Link>
          {movimientos.length > 0 && (
            <button onClick={() => setAbierto((v) => !v)}
              style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '5px', cursor: 'pointer', fontWeight: 600, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' }}>
              {abierto ? 'Ocultar detalle ▴' : 'Ver detalle ▾'}
            </button>
          )}
        </div>
      </div>

      {abierto && (
        <div style={{ marginTop: '10px', borderTop: '1px solid #f3f4f6', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {fechas.map((fecha) => (
            <div key={fecha}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#111827' }}>{fmtFecha(fecha)}</span>
                <span style={{ fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>{diasAtras(fecha)}</span>
                <span style={{ flex: 1, height: '1px', background: '#f3f4f6' }} />
                <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>{porFecha.get(fecha)!.length} mov.</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {porFecha.get(fecha)!.map((m) => {
                  const t = TIPO_LABEL[m.tipo] || TIPO_LABEL.descarte;
                  return (
                    <Link key={m.id} href={`/cultivos/${encodeURIComponent(m.lote)}`}
                      style={{ textDecoration: 'none', color: 'inherit', background: '#fafafa', borderLeft: `3px solid ${t.color}`, borderRadius: '6px', padding: '6px 9px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ background: t.bg, color: t.color, padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, minWidth: '66px', textAlign: 'center' }}>
                        {t.label}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '11.5px', color: '#1d4ed8' }}>{m.lote}</span>
                      {m.variedad && (
                        <span style={{ fontSize: '11px', color: m.esRucula ? '#166534' : '#4d7c0f', fontWeight: 500 }}>{m.variedad}</span>
                      )}
                      {m.fases && <span style={{ fontSize: '11px', color: '#6b7280' }}>{m.fases}</span>}
                      {m.ubicacion && (
                        <span style={{ fontSize: '10.5px', color: '#9ca3af', background: '#f3f4f6', padding: '1px 6px', borderRadius: '4px' }}>{m.ubicacion}</span>
                      )}
                      {m.cantidad && (
                        <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 600, color: '#374151' }}>{m.cantidad}</span>
                      )}
                      <span style={{ fontSize: '10.5px', color: '#9ca3af', minWidth: '54px', textAlign: 'right' }}>{m.usuario}</span>
                      {m.notas && (
                        <span style={{ flexBasis: '100%', fontSize: '10.5px', color: '#6b7280', fontStyle: 'italic' }}>{m.notas}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
