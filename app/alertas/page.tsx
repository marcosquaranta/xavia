// app/alertas/page.tsx
// Pantalla de Alertas y auditoría. Solo admin.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Movimiento } from '@/lib/types';
import Header from '@/components/Header';
import { parseISO, differenceInDays } from 'date-fns';

export const dynamic = 'force-dynamic';

export default async function AlertasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const movimientos = await readSheet<Movimiento>('Movimientos');

  // Solo cosechas con alertas (amarillas o rojas) de los últimos 30 días
  const hoy = new Date();
  const cosechasConAlerta = movimientos
    .filter(
      (m) =>
        m.tipo === 'cosecha' &&
        (m.nivel_alerta === 'amarillo' || m.nivel_alerta === 'rojo')
    )
    .filter((m) => {
      try {
        return differenceInDays(hoy, parseISO(m.fecha)) <= 30;
      } catch {
        return true;
      }
    })
    .sort((a, b) => {
      // Rojas primero, después por fecha más reciente
      if (a.nivel_alerta !== b.nivel_alerta) {
        return a.nivel_alerta === 'rojo' ? -1 : 1;
      }
      return b.fecha.localeCompare(a.fecha);
    });

  const rojas = cosechasConAlerta.filter((m) => m.nivel_alerta === 'rojo');
  const amarillas = cosechasConAlerta.filter((m) => m.nivel_alerta === 'amarillo');
  const pendientes = cosechasConAlerta.filter(
    (m) => !m.alerta_revisada || m.alerta_revisada === 'NO'
  );
  const revisadas = cosechasConAlerta.filter((m) => m.alerta_revisada === 'SI');

  // Stats por cosechador (últimos 30 días)
  const cosechadores = Array.from(
    new Set(
      movimientos
        .filter((m) => m.tipo === 'cosecha' && m.cosechador)
        .map((m) => m.cosechador)
    )
  );

  const statsCosechadores = cosechadores.map((c) => {
    const cosechasDelCosechador = movimientos.filter(
      (m) => m.tipo === 'cosecha' && m.cosechador === c
    );
    const recientes = cosechasDelCosechador.filter((m) => {
      try {
        return differenceInDays(hoy, parseISO(m.fecha)) <= 30;
      } catch {
        return false;
      }
    });
    const desvioPromedio =
      recientes.length > 0
        ? recientes.reduce((acc, m) => acc + (Number(m.desvio_porcentaje) || 0), 0) /
          recientes.length
        : 0;
    const ama = recientes.filter((m) => m.nivel_alerta === 'amarillo').length;
    const roj = recientes.filter((m) => m.nivel_alerta === 'rojo').length;
    return {
      cosechador: c,
      cosechas: recientes.length,
      desvio_promedio: Math.round(desvioPromedio * 10) / 10,
      amarillas: ama,
      rojas: roj,
    };
  }).sort((a, b) => b.desvio_promedio - a.desvio_promedio);

  return (
    <>
      <Header user={user} current="alertas" />
      <div className="container">
        <h1 className="page-title">Alertas y auditoría</h1>
        <p className="page-subtitle">
          Solo admin · Desvíos en cosechas · Últimos 30 días
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '10px',
            marginBottom: '20px',
          }}
        >
          <div style={{ background: '#fee2e2', borderRadius: '8px', padding: '12px' }}>
            <p
              style={{
                margin: 0,
                fontSize: '10px',
                color: '#7f1d1d',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Rojas (anomalías)
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 600, color: '#7f1d1d' }}>
              {rojas.length}
            </p>
          </div>
          <div style={{ background: '#fef3c7', borderRadius: '8px', padding: '12px' }}>
            <p
              style={{
                margin: 0,
                fontSize: '10px',
                color: '#78350f',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Amarillas (revisar)
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 600, color: '#78350f' }}>
              {amarillas.length}
            </p>
          </div>
          <div
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '12px',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: '10px',
                color: '#6b7280',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Pendientes de revisar
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 600 }}>
              {pendientes.length}
            </p>
          </div>
          <div
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '12px',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: '10px',
                color: '#6b7280',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Revisadas y OK
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 600 }}>
              {revisadas.length}
            </p>
          </div>
        </div>

        {cosechasConAlerta.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ margin: 0, color: '#9ca3af', fontSize: '14px' }}>
              No hay alertas en los últimos 30 días.
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {cosechasConAlerta.map((m) => (
              <AlertaRow key={m.id_movimiento} mov={m} />
            ))}
          </div>
        )}

        {statsCosechadores.length > 0 && (
          <div className="card">
            <p className="card-title">Patrones por cosechador (últimos 30 días)</p>
            <table>
              <thead>
                <tr>
                  <th>Cosechador</th>
                  <th style={{ textAlign: 'right' }}>Cosechas</th>
                  <th style={{ textAlign: 'right' }}>Desvío prom.</th>
                  <th style={{ textAlign: 'right' }}>🟡</th>
                  <th style={{ textAlign: 'right' }}>🔴</th>
                </tr>
              </thead>
              <tbody>
                {statsCosechadores.map((s) => (
                  <tr
                    key={s.cosechador}
                    style={{
                      background: s.desvio_promedio > 15 ? '#fef2f2' : 'transparent',
                    }}
                  >
                    <td style={{ fontWeight: s.desvio_promedio > 15 ? 500 : 400 }}>
                      {s.cosechador}
                    </td>
                    <td style={{ textAlign: 'right' }}>{s.cosechas}</td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 500,
                        color:
                          s.desvio_promedio > 15
                            ? '#7f1d1d'
                            : s.desvio_promedio > 5
                            ? '#78350f'
                            : '#374151',
                      }}
                    >
                      {s.desvio_promedio}%
                    </td>
                    <td style={{ textAlign: 'right' }}>{s.amarillas}</td>
                    <td style={{ textAlign: 'right' }}>{s.rojas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function AlertaRow({ mov }: { mov: Movimiento }) {
  const esRoja = mov.nivel_alerta === 'rojo';
  const esRevisada = mov.alerta_revisada === 'SI';
  const desvio = Number(mov.desvio_porcentaje) || 0;

  return (
    <div
      style={{
        padding: '12px 14px',
        borderLeft: '3px solid',
        borderLeftColor: esRevisada ? '#9ca3af' : esRoja ? '#dc2626' : '#d97706',
        background: esRevisada ? '#f9fafb' : esRoja ? '#fef2f2' : '#fffbeb',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        borderTop: '1px solid #f3f4f6',
        opacity: esRevisada ? 0.7 : 1,
      }}
    >
      <span
        style={{
          background: esRevisada ? '#e5e7eb' : esRoja ? '#dc2626' : '#d97706',
          color: esRevisada ? '#6b7280' : 'white',
          padding: '2px 8px',
          borderRadius: '10px',
          fontSize: '11px',
          fontWeight: 500,
          minWidth: '52px',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        +{Math.round(desvio)}%
      </span>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>
          Lote{' '}
          <Link
            href={`/cultivos/${encodeURIComponent(mov.id_lote)}`}
            className="lote-id"
            style={{ textDecoration: 'none' }}
          >
            {mov.id_lote}
          </Link>{' '}
          · {formatearFecha(mov.fecha)}
          {esRevisada && (
            <span style={{ color: '#059669', fontSize: '11px', marginLeft: '6px' }}>
              ✓ Revisada
            </span>
          )}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>
          Cosechador: {mov.cosechador || '—'} ·{' '}
          {Number(mov.unidades_cosechadas) || 0} unidades cosechadas ·{' '}
          {Number(mov.descarte_calculado) || 0} sin identificar
          {mov.alerta_comentario && (
            <>
              <br />
              <em>"{mov.alerta_comentario}"</em>
            </>
          )}
        </p>
      </div>
      {!esRevisada && (
        <Link
          href={`/alertas/${mov.id_movimiento}/revisar`}
          className="btn secondary small"
        >
          Revisar
        </Link>
      )}
    </div>
  );
}

function formatearFecha(f: string): string {
  if (!f) return '-';
  try {
    const [y, m, d] = f.split('-');
    return `${d}/${m}`;
  } catch {
    return f;
  }
}
