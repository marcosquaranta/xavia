// app/panel/page.tsx
// Panel principal con stats reales.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorNave } from '@/lib/ocupacion';
import {
  cosechaSemanaActual,
  cosechadoEsteMes,
  mapaDiasPromedio,
} from '@/lib/estadisticas';
import { calcularDiasPorFase } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

export default async function PanelPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [lotes, movimientos, ubicaciones, variedades] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Movimiento>('Movimientos'),
    readSheet<Ubicacion>('Ubicaciones'),
    readSheet<Variedad>('Variedades'),
  ]);

  const lotesActivos = lotes.filter((l) => l.estado === 'activo');
  const totalPlantasActivas = lotesActivos.reduce(
    (acc, l) =>
      acc +
      (Number(l.plantas_estimadas_actual) || Number(l.plantines_iniciales) || 0),
    0
  );

  const cosechaSem = cosechaSemanaActual(lotes);
  const { actual: cosechadoMes, pasado: cosechadoMesPasado } = cosechadoEsteMes(lotes);
  const diferenciaPct =
    cosechadoMesPasado > 0
      ? Math.round(((cosechadoMes - cosechadoMesPasado) / cosechadoMesPasado) * 100)
      : 0;

  const navesOcup = ocupacionPorNave(ubicaciones, lotes);
  const ocupacionGlobal =
    navesOcup.reduce((acc, n) => acc + n.plantas_vivas, 0) /
    Math.max(
      1,
      navesOcup.reduce((acc, n) => acc + n.capacidad_total, 0)
    );

  // Próximas 5 cosechas estimadas
  const diasMap = mapaDiasPromedio(lotes, movimientos);
  const proximas = lotesActivos
    .filter((l) => l.fase_actual === 'fase_2')
    .map((l) => {
      const dias = calcularDiasPorFase(l, movimientos);
      const variedad = variedades.find((v) => v.variedad === l.variedad);
      const ciclo = diasMap.get(l.variedad) || variedad?.dias_estimados_cosecha || 35;
      const restante = Math.max(0, ciclo - dias.total);
      const fechaEstimada = new Date();
      fechaEstimada.setDate(fechaEstimada.getDate() + restante);
      return {
        lote: l,
        cantidad:
          Number(l.plantas_estimadas_actual) || Number(l.plantines_iniciales) || 0,
        fecha: fechaEstimada,
        diasRestantes: restante,
      };
    })
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
    .slice(0, 5);

  const hoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <>
      <Header user={user} current="panel" />
      <div className="container">
        <h1 className="page-title">Panel de control</h1>
        <p className="page-subtitle">
          {hoy.charAt(0).toUpperCase() + hoy.slice(1)} · Bienvenido, {user.nombre}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          <Stat
            label="Lotes activos"
            value={lotesActivos.length}
            sub={`~${totalPlantasActivas.toLocaleString('es-AR')} plantas`}
          />
          <StatCosecha cosecha={cosechaSem} />
          <Stat
            label="Ocupación global"
            value={`${Math.round(ocupacionGlobal * 100)}%`}
            sub={navesOcup
              .map((n) => `Nave ${n.nave}: ${n.ocupacion_pct}%`)
              .join(' · ')}
          />
          <Stat
            label="Cosechado este mes"
            value={cosechadoMes.toLocaleString('es-AR')}
            sub={
              cosechadoMesPasado > 0
                ? `${diferenciaPct >= 0 ? '↑' : '↓'} ${Math.abs(
                    diferenciaPct
                  )}% vs mes ant.`
                : 'sin datos del mes anterior'
            }
            subColor={
              diferenciaPct > 0 ? '#059669' : diferenciaPct < 0 ? '#dc2626' : '#6b7280'
            }
          />
        </div>

        <div className="card">
          <p className="card-title">Acciones rápidas</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Link href="/cultivos/nuevo" className="btn">
              + Nuevo lote
            </Link>
            <Link href="/cultivos" className="btn secondary">
              Mis cultivos
            </Link>
            <Link href="/ocupacion" className="btn secondary">
              Ver ocupación
            </Link>
            <Link href="/estadisticas" className="btn secondary">
              Estadísticas
            </Link>
          </div>
        </div>

        <div className="card">
          <p className="card-title">Próximas cosechas</p>
          {proximas.length === 0 ? (
            <p
              style={{
                color: '#9ca3af',
                fontSize: '13px',
                textAlign: 'center',
                padding: '16px',
              }}
            >
              No hay lotes en Fase 2 actualmente.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Variedad</th>
                  <th>Ubicación</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>Fecha est.</th>
                </tr>
              </thead>
              <tbody>
                {proximas.map((p) => (
                  <tr key={p.lote.id_lote}>
                    <td>
                      <Link
                        href={`/cultivos/${encodeURIComponent(p.lote.id_lote)}`}
                        className="lote-id"
                        style={{ textDecoration: 'none' }}
                      >
                        {p.lote.id_lote}
                      </Link>
                    </td>
                    <td>{p.lote.variedad}</td>
                    <td style={{ color: '#6b7280' }}>{p.lote.ubicacion_actual}</td>
                    <td style={{ textAlign: 'right' }}>~{p.cantidad}</td>
                    <td style={{ textAlign: 'right' }}>
                      {p.fecha.toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                      })}
                      {p.diasRestantes <= 3 && (
                        <span
                          style={{
                            color: '#059669',
                            marginLeft: '6px',
                            fontWeight: 500,
                          }}
                        >
                          ({p.diasRestantes}d)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  subColor,
}: {
  label: string;
  value: string | number;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '10px',
        padding: '16px',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: '11px',
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
        }}
      >
        {label}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: '24px', fontWeight: 600 }}>{value}</p>
      {sub && (
        <p
          style={{
            margin: '4px 0 0',
            fontSize: '11px',
            color: subColor || '#6b7280',
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

function StatCosecha({
  cosecha,
}: {
  cosecha: ReturnType<typeof cosechaSemanaActual>;
}) {
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '10px',
        padding: '16px',
      }}
    >
      <p
        style={{
          margin: '0 0 8px',
          fontSize: '11px',
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
        }}
      >
        Cosecha esta semana
      </p>
      <div style={{ fontSize: '12px', lineHeight: 1.7 }}>
        <div style={{ color: '#4d7c0f' }}>
          Lech. Crespa: <strong>{cosecha.lechuga_crespa}</strong>
        </div>
        <div style={{ color: '#4d7c0f' }}>
          H. Roble: <strong>{cosecha.lechuga_roble}</strong>
        </div>
        <div style={{ color: '#166534' }}>
          Rúcula: <strong>{cosecha.rucula_paquetes}</strong> paq.
        </div>
        <div style={{ color: '#047857' }}>
          Albahaca: <strong>{cosecha.albahaca_paquetes}</strong> paq.
        </div>
      </div>
    </div>
  );
}
