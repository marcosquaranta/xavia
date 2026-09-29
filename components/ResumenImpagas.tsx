'use client';
import { useMemo, useState } from 'react';
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
  clientes, facturasPorCliente, conRecordatorio = [],
}: {
  clientes: ClienteImpagas[];
  facturasPorCliente: Record<string, FacturaCliente[]>;
  // Los que tienen el recordatorio prendido. Se marcan porque cambia qué hacer con la
  // deuda: si el cliente no recibe recordatorio, esa plata no se está reclamando sola.
  conRecordatorio?: string[];
}) {
  const [abierto, setAbierto] = useState<string | null>(null);

  const prendidos = useMemo(() => new Set(conRecordatorio.map(String)), [conRecordatorio]);

  const filas = useMemo(() => {
    return clientes
      .map((c) => {
        const impagas = (facturasPorCliente[c.id_control] || [])
          .filter((f) => !f.yaCobrada && !f.saldadaManual)
          .slice()
          .sort((a, b) => a.fecha.localeCompare(b.fecha));
        const total = impagas.reduce((a, f) => a + f.importe, 0);
        return {
          ...c,
          impagas,
          total,
          masVieja: impagas[0]?.fecha || '',
          reclama: prendidos.has(String(c.id_control)),
        };
      })
      .filter((f) => f.impagas.length > 0)
      .sort((a, b) => b.total - a.total);
  }, [clientes, facturasPorCliente, prendidos]);

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
            <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 700 }}>{f.nombre} — {f.impagas.length} impagas</p>
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

      {sinReclamo.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#92400e' }}>
          {fmt(totalSinReclamo)} de {sinReclamo.length === 1 ? 'un cliente' : `${sinReclamo.length} clientes`} sin
          recordatorio prendido: esa plata no se reclama sola.
        </p>
      )}
    </div>
  );
}
