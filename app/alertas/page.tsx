// app/alertas/[id]/revisar/page.tsx
// Pantalla para revisar una alerta y dejar comentario.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Movimiento } from '@/lib/types';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

export default async function RevisarAlertaPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const movimientos = await readSheet<Movimiento>('Movimientos');
  const mov = movimientos.find((m) => String(m.id_movimiento) === params.id);
  if (!mov) notFound();

  return (
    <>
      <Header user={user} current="alertas" />
      <div className="container">
        <Link
          href="/alertas"
          style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}
        >
          ← Volver a Alertas
        </Link>

        <h1 className="page-title">
          Revisar alerta · Lote{' '}
          <span className="lote-id" style={{ fontSize: '14px' }}>
            {mov.id_lote}
          </span>
        </h1>
        <p className="page-subtitle">
          Cosecha del {mov.fecha} · Cosechador: {mov.cosechador || '—'}
        </p>

        <div className="card">
          <p className="card-title">Datos de la cosecha</p>
          <table>
            <tbody>
              <tr>
                <td style={{ color: '#6b7280', width: '180px' }}>Unidades cosechadas</td>
                <td>{mov.unidades_cosechadas}</td>
              </tr>
              <tr>
                <td style={{ color: '#6b7280' }}>Descarte calculado</td>
                <td>{mov.descarte_calculado}</td>
              </tr>
              <tr>
                <td style={{ color: '#6b7280' }}>Desvío</td>
                <td>
                  <strong>+{mov.desvio_porcentaje}%</strong>
                </td>
              </tr>
              <tr>
                <td style={{ color: '#6b7280' }}>Nivel</td>
                <td>
                  <span
                    className="pill"
                    style={{
                      background: mov.nivel_alerta === 'rojo' ? '#fee2e2' : '#fef3c7',
                      color: mov.nivel_alerta === 'rojo' ? '#7f1d1d' : '#78350f',
                    }}
                  >
                    {mov.nivel_alerta}
                  </span>
                </td>
              </tr>
              {mov.notas && (
                <tr>
                  <td style={{ color: '#6b7280' }}>Notas</td>
                  <td>{mov.notas}</td>
                </tr>
              )}
              {mov.foto_url && (
                <tr>
                  <td style={{ color: '#6b7280' }}>Foto</td>
                  <td>
                    <a href={mov.foto_url} target="_blank" rel="noopener noreferrer">
                      Ver foto en Drive →
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form action="/api/alertas/revisar" method="POST" className="card">
          <input type="hidden" name="id_movimiento" value={mov.id_movimiento} />
          <p className="card-title">Comentario de revisión</p>
          <p className="card-sub">
            Dejá un comentario explicando la causa o resolución de esta alerta.
          </p>
          <textarea
            name="comentario"
            rows={4}
            required
            placeholder="Ej: Lote con plantas chicas, compensación legítima — habló con el cosechador"
            style={{ resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            <button type="submit" className="btn">
              Marcar como revisada
            </button>
            <Link href="/alertas" className="btn secondary">
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
