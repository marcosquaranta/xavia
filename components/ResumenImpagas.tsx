'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FacturaCliente } from '@/lib/facturasCliente';

// ── Quién debe qué ───────────────────────────────────────────────────────────────────
//
// Hasta acá la deuda por cliente solo existía adentro del mail de recordatorio: para saber
// cuánto debía alguien había que mandarle el reclamo y leerlo. Esta tabla es el mismo
// cálculo, mirable sin mandar nada.
//
// Importa que sea el MISMO cálculo y no uno parecido: si la pantalla y el mail dieran
// números distintos, no habría forma de saber cuál está bien, y el mail ya salió.

export interface ClienteImpagas { id_control: string; nombre: string }

// La última vez que se controló la cuenta de cada cliente, con la foto de lo que había.
export interface RevisionUI {
  id_control: string;
  fecha: string;
  usuario: string;
  facturas_abiertas: number;
  monto_abierto: number;
}

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtFecha = (f: string) => {
  const [y, m, d] = String(f || '').split('-');
  return d ? `${d}/${m}/${String(y).slice(2)}` : '—';
};
const diasDesde = (f: string) => {
  const t = new Date(String(f) + 'T12:00:00').getTime();
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 86400000) : 0;
};

export default function ResumenImpagas({
  clientes, facturasPorCliente, conRecordatorio = [], revisiones = {}, diasRevisionVieja = 30,
}: {
  clientes: ClienteImpagas[];
  facturasPorCliente: Record<string, FacturaCliente[]>;
  // Los que tienen el recordatorio prendido. Se marcan porque cambia qué hacer con la
  // deuda: si el cliente no recibe recordatorio, esa plata no se está reclamando sola.
  conRecordatorio?: string[];
  revisiones?: Record<string, RevisionUI>;
  diasRevisionVieja?: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Dejar asentado que se controló esta cuenta. Guarda además cuántas facturas abiertas
  // había y por cuánto: sin esa foto, el sello solo dice cuándo alguien afirmó que estaba
  // bien, y no hay forma de ver qué cambió después.
  async function marcarRevisado(id: string, nombre: string, facturas: number, monto: number) {
    setMarcando(id); setMsg(null);
    try {
      const r = await fetch('/api/cobranzas/revision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_control: id, cliente: nombre, facturasAbiertas: facturas, montoAbierto: monto }),
      });
      const j = await r.json();
      setMsg(r.ok ? `✓ ${nombre}: revisión registrada.` : (j?.error || 'No se pudo registrar.'));
      if (r.ok) router.refresh();
    } catch (e: any) {
      setMsg(e?.message || 'No se pudo registrar.');
    } finally {
      setMarcando(null);
    }
  }

  const prendidos = useMemo(() => new Set(conRecordatorio.map(String)), [conRecordatorio]);

  const filas = useMemo(() => {
    return clientes
      .map((c) => {
        const impagas = (facturasPorCliente[c.id_control] || [])
          // Mismo criterio que el de la página y el del mail: lo que la app ya dio por
          // cobrado —imputado desde un cobro, imputado a mano sobre un cobro de Xubio, o
          // dado por saldado— no es deuda. Un criterio distinto acá y la tabla contradice
          // al reclamo que sale por mail, sin forma de saber cuál está bien.
          .filter((f) => !f.yaCobrada && !f.saldadaManual && !f.cubierta && !f.imputadaManual)
          .slice()
          .sort((a, b) => a.fecha.localeCompare(b.fecha));
        const total = impagas.reduce((a, f) => a + f.importe, 0);
        const rev = revisiones[String(c.id_control)];
        return {
          ...c,
          impagas,
          total,
          masVieja: impagas[0]?.fecha || '',
          reclama: prendidos.has(String(c.id_control)),
          rev,
          diasRev: rev ? diasDesde(rev.fecha) : null,
        };
      })
      .filter((f) => f.impagas.length > 0)
      .sort((a, b) => b.total - a.total);
  }, [clientes, facturasPorCliente, prendidos, revisiones]);

  const totalGeneral = filas.reduce((a, f) => a + f.total, 0);
  const sinReclamo = filas.filter((f) => !f.reclama);
  const totalSinReclamo = sinReclamo.reduce((a, f) => a + f.total, 0);

  if (!filas.length) {
    return <p style={{ margin: 0, fontSize: '13px', color: '#059669' }}>No hay facturas impagas.</p>;
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '460px' }}>
          <thead>
            <tr style={{ background: '#f9fafb', color: '#6b7280', fontSize: '11.5px' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Facturas</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Total</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>La más vieja</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Revisado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const dias = diasDesde(f.masVieja);
              const esta = abierto === f.id_control;
              return (
                <tr key={f.id_control} style={{ borderTop: '1px solid #f3f4f6', cursor: 'pointer', background: esta ? '#f8fafc' : undefined }}
                  onClick={() => setAbierto(esta ? null : f.id_control)}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                    <span style={{ color: '#9ca3af', fontSize: '10px', marginRight: '5px' }}>{esta ? '▾' : '▸'}</span>
                    {f.nombre}
                    {!f.reclama && (
                      <span title="Este cliente no tiene el recordatorio prendido: esta deuda no se reclama sola"
                        style={{ marginLeft: '6px', fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px', background: '#fef3c7', color: '#92400e' }}>
                        sin recordatorio
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{f.impagas.length}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(f.total)}</td>
                  <td style={{ padding: '6px 8px', color: dias > 60 ? '#b45309' : '#6b7280' }}>
                    {fmtFecha(f.masVieja)} <span style={{ fontSize: '11px', color: '#9ca3af' }}>({dias} días)</span>
                  </td>
                  {/* Hace cuánto que nadie controla esta cuenta. En ámbar pasado el plazo y
                      en rojo al doble: una cuenta sin revisar hace dos meses es donde se
                      esconden los errores de imputación. */}
                  <td style={{ padding: '6px 8px', fontSize: '12px' }}>
                    {f.diasRev === null ? (
                      <span style={{ color: '#b45309' }}>nunca</span>
                    ) : (
                      <span style={{ color: f.diasRev > diasRevisionVieja * 2 ? '#dc2626' : f.diasRev > diasRevisionVieja ? '#b45309' : '#059669' }}>
                        hace {f.diasRev} {f.diasRev === 1 ? 'día' : 'días'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: '2px solid #e5e7eb' }}>
              <td style={{ padding: '8px', fontWeight: 800 }}>Total</td>
              <td style={{ padding: '8px', textAlign: 'right', color: '#6b7280' }}>
                {filas.reduce((a, f) => a + f.impagas.length, 0)}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalGeneral)}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* El detalle del cliente abierto, abajo de la tabla: dentro de la fila rompía el
          ancho de las columnas y se leía peor. */}
      {abierto && (() => {
        const f = filas.find((x) => x.id_control === abierto);
        if (!f) return null;
        return (
          <div style={{ marginTop: '10px', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: 700 }}>{f.nombre} — {f.impagas.length} impagas</p>
              <button
                type="button"
                onClick={() => marcarRevisado(f.id_control, f.nombre, f.impagas.length, f.total)}
                disabled={marcando === f.id_control}
                style={{ fontSize: '11.5px', fontWeight: 700, padding: '4px 12px', borderRadius: '6px', border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', cursor: 'pointer' }}
              >
                {marcando === f.id_control ? 'Guardando…' : '✓ Marcar como revisado'}
              </button>
            </div>
            {/* Qué cambió desde la última revisión. Es lo que convierte el sello en algo
                verificable: sin esto solo dice cuándo alguien dijo que estaba bien. */}
            {f.rev && (
              <p style={{ margin: '0 0 6px', fontSize: '11.5px', color: '#6b7280', background: '#f8fafc', borderRadius: '6px', padding: '5px 8px' }}>
                Revisado el {fmtFecha(f.rev.fecha)} por {f.rev.usuario}: en ese momento {f.rev.facturas_abiertas} impagas
                por {fmt(f.rev.monto_abierto)}.
                {(f.impagas.length !== f.rev.facturas_abiertas || Math.round(f.total) !== Math.round(f.rev.monto_abierto)) && (
                  <strong style={{ color: '#b45309' }}>
                    {' '}Desde entonces: {f.impagas.length - f.rev.facturas_abiertas >= 0 ? '+' : ''}
                    {f.impagas.length - f.rev.facturas_abiertas} facturas, {Math.round(f.total - f.rev.monto_abierto) >= 0 ? '+' : '−'}
                    {fmt(Math.abs(f.total - f.rev.monto_abierto))}.
                  </strong>
                )}
              </p>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <tbody>
                {f.impagas.map((x) => (
                  <tr key={x.numero} style={{ borderTop: '1px solid #f9fafb' }}>
                    <td style={{ padding: '3px 6px', fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}>{x.numero}</td>
                    <td style={{ padding: '3px 6px', color: '#6b7280' }}>{fmtFecha(x.fecha)}</td>
                    <td style={{ padding: '3px 6px', color: '#9ca3af' }}>{diasDesde(x.fecha)} días</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(x.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {msg && <p style={{ margin: '8px 0 0', fontSize: '12px', fontWeight: 600, color: msg.startsWith('✓') ? '#059669' : '#dc2626' }}>{msg}</p>}

      {sinReclamo.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#92400e' }}>
          {fmt(totalSinReclamo)} de {sinReclamo.length === 1 ? 'un cliente' : `${sinReclamo.length} clientes`} sin
          recordatorio prendido: esa plata no se reclama sola.
        </p>
      )}
    </div>
  );
}
