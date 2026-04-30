// app/cultivos/[id]/page.tsx
// Pantalla detalle de un lote: muestra info actual + historial de movimientos.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, deleteRow } from '@/lib/sheets';
import { calcularDiasPorFase, claseVariedad } from '@/lib/lotes';
import type { Lote, Movimiento, Variedad } from '@/lib/types';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

export default async function DetalleLotePage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const idLote = decodeURIComponent(params.id);

  const [lotes, movimientos, variedades] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Movimiento>('Movimientos'),
    readSheet<Variedad>('Variedades'),
  ]);

  const lote = lotes.find((l) => l.id_lote === idLote);
  if (!lote) notFound();

  const dias = calcularDiasPorFase(lote, movimientos);
  const movsLote = movimientos
    .filter((m) => m.id_lote === idLote)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const variedad = variedades.find((v) => v.variedad === lote.variedad);

  const labelFase =
    lote.fase_actual === 'plantin'
      ? 'Plantín'
      : lote.fase_actual === 'fase_1'
      ? 'Fase 1'
      : 'Fase 2';

  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <Link
          href="/cultivos"
          style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}
        >
          ← Volver a Mis cultivos
        </Link>

        <div className={`lote-row ${claseVariedad(lote)}`} style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span className="lote-id" style={{ fontSize: '14px' }}>
              {lote.id_lote}
            </span>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
              {lote.variedad}
            </h1>
            <span className={`pill ${lote.estado === 'cosechado' ? 'fase2' : 'fase1'}`}>
              {lote.estado === 'cosechado' ? 'Cosechado' : labelFase}
            </span>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#6b7280' }}>
            {lote.ubicacion_actual} ·{' '}
            {lote.estado === 'cosechado'
              ? `cosechado el ${formatearFecha(lote.fecha_cosecha)}`
              : `plantines iniciales: ${lote.plantines_iniciales}`}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          <Stat label="Sembrado" value={formatearFechaCompleta(dias.fechas.siembra)} sub={`hace ${dias.total} días`} />
          <Stat label="Plantinera" value={`${dias.plantinera} días`} />
          {dias.fase_1 !== null && <Stat label="Fase 1" value={`${dias.fase_1} días`} />}
          {dias.fase_2 > 0 && <Stat label="Fase 2" value={`${dias.fase_2} días`} />}
          {variedad && (
            <Stat
              label="Ciclo estimado"
              value={`${variedad.dias_estimados_cosecha} días`}
              sub="esperado de la variedad"
            />
          )}
          {lote.estado === 'cosechado' && (
            <Stat
              label="Cosechado"
              value={`${lote.unidades_cosechadas || 0} ${
                lote.destino_cosecha === 'planta' ? 'plantas' : 'paquetes'
              }`}
              sub={`peso ~${lote.peso_total_estimado_kg || 0} kg`}
            />
          )}
        </div>

        {lote.estado === 'activo' && (
          <div className="card">
            <p className="card-title">Acciones</p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {lote.fase_actual !== 'fase_2' && (
                <Link
                  href={`/cultivos/${encodeURIComponent(lote.id_lote)}/trasplantar`}
                  className="btn"
                >
                  Trasplantar
                </Link>
              )}
              {lote.fase_actual === 'fase_2' && (
                <Link
                  href={`/cultivos/${encodeURIComponent(lote.id_lote)}/cosechar`}
                  className="btn"
                >
                  Cosechar
                </Link>
              )}
              {user.rol === 'admin' && (
                <form action="/api/lotes/borrar" method="POST" style={{ display: 'inline' }}>
                  <input type="hidden" name="id_lote" value={lote.id_lote} />
                  <button
                    type="submit"
                    className="btn danger"
                    onClick={(e) => {
                      if (
                        !confirm(
                          `¿Borrar permanentemente el lote ${lote.id_lote} y todos sus movimientos?`
                        )
                      ) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Borrar lote
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        <div className="card">
          <p className="card-title">Historial de movimientos</p>
          {movsLote.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>
              Sin movimientos registrados
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {movsLote.map((m) => (
                  <tr key={m.id_movimiento}>
                    <td>{formatearFecha(m.fecha)}</td>
                    <td>{labelTipo(m.tipo)}</td>
                    <td style={{ color: '#6b7280' }}>
                      {m.fase_origen ? labelFase2(m.fase_origen) : '-'}
                    </td>
                    <td style={{ color: '#6b7280' }}>
                      {m.fase_destino ? labelFase2(m.fase_destino) : '-'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {m.tipo === 'cosecha'
                        ? `${m.unidades_cosechadas || 0} u`
                        : m.plantas_estimadas || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {lote.notas && (
          <div className="card">
            <p className="card-title">Notas</p>
            <p style={{ margin: 0, fontSize: '13px', whiteSpace: 'pre-wrap' }}>
              {lote.notas}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '14px',
      }}
    >
      <p style={{ margin: 0, fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
        {label}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 600 }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#9ca3af' }}>{sub}</p>}
    </div>
  );
}

function formatearFecha(fecha: string): string {
  if (!fecha) return '-';
  try {
    const [y, m, d] = fecha.split('-');
    return `${d}/${m}`;
  } catch {
    return fecha;
  }
}

function formatearFechaCompleta(fecha: string): string {
  if (!fecha) return '-';
  try {
    const [y, m, d] = fecha.split('-');
    return `${d}/${m}/${y}`;
  } catch {
    return fecha;
  }
}

function labelTipo(tipo: string): string {
  if (tipo === 'siembra') return 'Siembra';
  if (tipo === 'trasplante') return 'Trasplante';
  if (tipo === 'cosecha') return 'Cosecha';
  if (tipo === 'descarte') return 'Descarte';
  return tipo;
}

function labelFase2(f: string): string {
  if (f === 'plantin') return 'Plantín';
  if (f === 'fase_1') return 'Fase 1';
  if (f === 'fase_2') return 'Fase 2';
  return f;
}
