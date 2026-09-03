import Link from 'next/link';
import type { PasoCierre } from '@/lib/cierreChecklist';

// Los pasos del cierre, con el estado que la app puede verificar sola. Los que no puede
// verificar van como recordatorio en gris y sin tilde: un tilde puesto por adivinanza es
// peor que ninguno, porque das por hecho algo que no pasó.

const ESTILO = {
  listo: { icono: '✓', color: '#059669', fondo: '#f0fdf4' },
  pendiente: { icono: '!', color: '#b45309', fondo: '#fffbeb' },
  recordatorio: { icono: '·', color: '#9ca3af', fondo: 'transparent' },
} as const;

export default function ChecklistCierre({ pasos, listos, pendientes, total }: {
  pasos: PasoCierre[]; listos: number; pendientes: number; total: number;
}) {
  return (
    <details open={pendientes > 0} style={{ marginBottom: '12px' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: pendientes > 0 ? '#fffbeb' : '#f0fdf4', border: `1px solid ${pendientes > 0 ? '#fde68a' : '#bbf7d0'}`, borderRadius: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: pendientes > 0 ? '#92400e' : '#166534' }}>
          Checklist del cierre
        </span>
        <span style={{ fontSize: '12px', color: pendientes > 0 ? '#92400e' : '#166534' }}>
          {pendientes > 0 ? `${listos} de ${total} · faltan ${pendientes}` : `${total} de ${total} — todo lo verificable está`}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9ca3af' }}>abrir / cerrar</span>
      </summary>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '8px' }}>
        {pasos.map((p, i) => {
          const e = ESTILO[p.estado];
          return (
            <div key={i} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', padding: '7px 10px', background: e.fondo, borderRadius: '6px' }}>
              <span style={{
                flexShrink: 0, width: '17px', height: '17px', borderRadius: '50%', marginTop: '1px',
                background: p.estado === 'recordatorio' ? 'transparent' : e.color,
                color: p.estado === 'recordatorio' ? e.color : 'white',
                border: p.estado === 'recordatorio' ? '1px solid #e5e7eb' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700,
              }}>{e.icono}</span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: p.estado === 'pendiente' ? 700 : 500, color: '#111827' }}>
                  {p.titulo}
                  {p.href && (
                    <Link href={p.href} style={{ marginLeft: '8px', fontSize: '11.5px', fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>ir →</Link>
                  )}
                </p>
                <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: '#6b7280', lineHeight: 1.45 }}>{p.detalle}</p>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af' }}>
        Los puntos grises son pasos que la app no puede verificar sola — están para que no se te pasen.{' '}
        <Link href="/eerr/instrucciones" style={{ color: '#2563eb', fontWeight: 600 }}>Ver instrucciones completas del cierre →</Link>
      </p>
    </details>
  );
}
