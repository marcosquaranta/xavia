'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PasoCierre } from '@/lib/cierreChecklist';

// Los pasos del cierre, numerados, con el estado que la app puede verificar sola.
//
// Los que no puede verificar —bajar el resumen del banco, comparar contra el Excel, dar el
// mes por cerrado— se marcan a mano y quedan guardados. Antes iban en gris sin forma de
// tildarlos, así que cada vez que se volvía a la pantalla había que acordarse de cuáles ya
// estaban hechos. Lo que NO se hace es tildarlos solos: un tilde puesto por adivinanza es
// peor que ninguno, porque das por hecho algo que no pasó.

const ESTILO = {
  listo: { icono: '✓', color: '#059669', fondo: '#f0fdf4' },
  pendiente: { icono: '!', color: '#b45309', fondo: '#fffbeb' },
  recordatorio: { icono: '·', color: '#9ca3af', fondo: 'transparent' },
} as const;

export default function ChecklistCierre({ pasos, listos, pendientes, total, anio, mes, marcados = [] }: {
  pasos: PasoCierre[]; listos: number; pendientes: number; total: number;
  anio: number; mes: number; marcados?: string[];
}) {
  const router = useRouter();
  const [hechos, setHechos] = useState<Set<string>>(() => new Set(marcados));
  const [guardando, setGuardando] = useState<string | null>(null);

  async function alternar(paso: string) {
    const nuevo = !hechos.has(paso);
    setGuardando(paso);
    // Se marca en pantalla al instante: el guardado va por detrás y, si falla, se revierte.
    setHechos((p) => { const n = new Set(p); if (nuevo) n.add(paso); else n.delete(paso); return n; });
    try {
      const r = await fetch('/api/eerr/paso', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anio, mes, paso, hecho: nuevo }),
      });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch {
      setHechos((p) => { const n = new Set(p); if (nuevo) n.delete(paso); else n.add(paso); return n; });
    } finally {
      setGuardando(null);
    }
  }

  // Los marcados a mano cuentan como hechos: si no, el contador diría "faltan 3" cuando los
  // tres están hechos y lo único que pasa es que la app no los puede ver.
  const manualesHechos = pasos.filter((p) => p.manual && hechos.has(p.id)).length;
  const listosTotal = listos + manualesHechos;
  const faltan = total - listosTotal;

  return (
    <details open={faltan > 0} style={{ marginBottom: '12px' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: faltan > 0 ? '#fffbeb' : '#f0fdf4', border: `1px solid ${faltan > 0 ? '#fde68a' : '#bbf7d0'}`, borderRadius: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: faltan > 0 ? '#92400e' : '#166534' }}>
          Checklist del cierre
        </span>
        <span style={{ fontSize: '12px', color: faltan > 0 ? '#92400e' : '#166534' }}>
          {faltan > 0 ? `${listosTotal} de ${total} · faltan ${faltan}` : `${total} de ${total} — el mes está cerrado`}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9ca3af' }}>abrir / cerrar</span>
      </summary>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '8px' }}>
        {pasos.map((p, i) => {
          const marcado = p.manual && hechos.has(p.id);
          const estado = marcado ? 'listo' : p.estado;
          const e = ESTILO[estado];
          return (
            <div key={p.id} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', padding: '7px 10px', background: e.fondo, borderRadius: '6px' }}>
              {/* El número va afuera del tilde: el tilde dice si está hecho y el número dice
                  en qué orden va, y mezclarlos obliga a leer dos cosas en el mismo lugar. */}
              <span style={{ flexShrink: 0, width: '18px', fontSize: '11.5px', color: '#9ca3af', fontWeight: 700, marginTop: '1px', textAlign: 'right' }}>
                {i + 1}.
              </span>
              {p.manual ? (
                <input
                  type="checkbox"
                  checked={!!marcado}
                  onChange={() => alternar(p.id)}
                  disabled={guardando === p.id}
                  title="Marcalo cuando lo hayas hecho"
                  style={{ flexShrink: 0, marginTop: '2px', width: '15px', height: '15px', cursor: 'pointer' }}
                />
              ) : (
                <span style={{
                  flexShrink: 0, width: '17px', height: '17px', borderRadius: '50%', marginTop: '1px',
                  background: estado === 'recordatorio' ? 'transparent' : e.color,
                  color: estado === 'recordatorio' ? e.color : 'white',
                  border: estado === 'recordatorio' ? '1px solid #e5e7eb' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 700,
                }}>{e.icono}</span>
              )}
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: estado === 'pendiente' ? 700 : 500, color: marcado ? '#6b7280' : '#111827', textDecoration: marcado ? 'line-through' : 'none' }}>
                  {p.titulo}
                  {p.href && (
                    <Link href={p.href} style={{ marginLeft: '8px', fontSize: '11.5px', fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>ir →</Link>
                  )}
                </p>
                <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: '#6b7280', lineHeight: 1.45 }}>{p.detalle}</p>
                {p.ayuda && (
                  <details style={{ marginTop: '2px' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '11px', color: '#2563eb', fontWeight: 600, listStyle: 'revert' }}>
                      cómo se hace
                    </summary>
                    <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#4b5563', lineHeight: 1.5, background: 'white', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '6px 9px' }}>
                      {p.ayuda}
                    </p>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: '#9ca3af', lineHeight: 1.5 }}>
        Los pasos con tilde los marcás vos: son los que la app no puede verificar sola. Los demás se ponen en ✓
        cuando el dato está cargado — no se tildan por adivinanza. Cada paso tiene su “cómo se hace” al lado.{' '}
        <Link href="/eerr/instrucciones" style={{ color: '#2563eb' }}>Qué va en la app y qué queda en Xubio →</Link>
      </p>
    </details>
  );
}
