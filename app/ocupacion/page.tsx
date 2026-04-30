// app/ocupacion/page.tsx
// Pantalla de Ocupación e indicadores.

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import {
  ocupacionPorMesada,
  ocupacionPorNave,
  proyectarEntregas,
  nivelOcupacion,
} from '@/lib/ocupacion';
import { mapaDiasPromedio, diasPromedioPorVariedad } from '@/lib/estadisticas';
import type { Lote, Movimiento, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

export default async function OcupacionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [lotes, movimientos, ubicaciones] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Movimiento>('Movimientos'),
    readSheet<Ubicacion>('Ubicaciones'),
  ]);

  const mesadas = ocupacionPorMesada(ubicaciones, lotes);
  const naves = ocupacionPorNave(ubicaciones, lotes);
  const tiempos = diasPromedioPorVariedad(lotes, movimientos, 60);
  const diasMap = mapaDiasPromedio(lotes, movimientos);
  const entregas = proyectarEntregas(lotes, diasMap, 2);

  // Stats globales
  const capacidadTotal = naves.reduce((acc, n) => acc + n.capacidad_total, 0);
  const plantasTotales = naves.reduce((acc, n) => acc + n.plantas_vivas, 0);
  const huecosLibres = capacidadTotal - plantasTotales;
  const ocupacionGlobal =
    capacidadTotal > 0 ? Math.round((plantasTotales / capacidadTotal) * 100) : 0;

  // Próximas 4 entregas (Lun/Mar y Jue/Vie de las próximas 2 semanas)
  const entregasAgrupadas: Array<{ titulo: string; entrega: typeof entregas[0]; principal: boolean }> = [];
  for (let i = 0; i < entregas.length && entregasAgrupadas.length < 4; i++) {
    const e = entregas[i];
    const principal = entregasAgrupadas.length < 2;
    if (e.diaSemana === 'lunes') {
      entregasAgrupadas.push({
        titulo: principal ? 'Lun/Mar próximos' : 'Lun/Mar sem siguiente',
        entrega: e,
        principal,
      });
    } else if (e.diaSemana === 'jueves') {
      entregasAgrupadas.push({
        titulo: principal ? 'Jue/Vie próximos' : 'Jue/Vie sem siguiente',
        entrega: e,
        principal,
      });
    }
  }

  return (
    <>
      <Header user={user} current="ocupacion" />
      <div className="container">
        <h1 className="page-title">Ocupación e indicadores</h1>
        <p className="page-subtitle">
          El espacio es tu recurso más caro · Capacidad instalada total:{' '}
          {capacidadTotal.toLocaleString('es-AR')} posiciones
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          <Stat
            label="Ocupación global"
            value={`${ocupacionGlobal}%`}
            sub={`${plantasTotales.toLocaleString('es-AR')} de ${capacidadTotal.toLocaleString('es-AR')}`}
          />
          <Stat
            label="Plantas activas"
            value={plantasTotales.toLocaleString('es-AR')}
            sub={`En ${lotes.filter((l) => l.estado === 'activo').length} lotes`}
          />
          <Stat
            label="Huecos libres"
            value={huecosLibres.toLocaleString('es-AR')}
            sub="Disponibles para sembrar"
          />
        </div>

        <div className="card">
          <p className="card-title">Densidad por nave (eficiencia del espacio)</p>
          <p className="card-sub">
            Plantas vivas por m². Compara qué nave produce más por metro cuadrado.
          </p>
          <table>
            <thead>
              <tr>
                <th>Nave</th>
                <th style={{ textAlign: 'right' }}>Sup. (m²)</th>
                <th style={{ textAlign: 'right' }}>Capacidad máx.</th>
                <th style={{ textAlign: 'right' }}>Plantas vivas</th>
                <th style={{ textAlign: 'right' }}>Densidad actual</th>
                <th style={{ textAlign: 'right' }}>Densidad máx.</th>
                <th style={{ textAlign: 'right' }}>Ocupación</th>
              </tr>
            </thead>
            <tbody>
              {naves.map((n) => (
                <tr key={n.nave}>
                  <td>Nave {n.nave}</td>
                  <td style={{ textAlign: 'right' }}>{n.metros_cuadrados}</td>
                  <td style={{ textAlign: 'right' }}>
                    {n.capacidad_total.toLocaleString('es-AR')}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {n.plantas_vivas.toLocaleString('es-AR')}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>
                    {n.densidad_actual} pl/m²
                  </td>
                  <td style={{ textAlign: 'right' }}>{n.densidad_maxima} pl/m²</td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontWeight: 500,
                      color:
                        n.ocupacion_pct >= 70
                          ? '#059669'
                          : n.ocupacion_pct >= 40
                          ? '#d97706'
                          : '#dc2626',
                    }}
                  >
                    {n.ocupacion_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {entregasAgrupadas.length > 0 && (
          <div className="card">
            <p className="card-title">Proyección de entregas</p>
            <p className="card-sub">
              Calculado con los tiempos reales que viene tardando cada variedad. Todo
              en plantas (rúcula y albahaca con paquetes de referencia).
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '10px',
              }}
            >
              {entregasAgrupadas.map((e, i) => (
                <ProyeccionCard key={i} titulo={e.titulo} entrega={e.entrega} principal={e.principal} />
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <p className="card-title">Ocupación por mesada</p>
          {mesadas.map((m) => {
            const nivel = nivelOcupacion(m.ocupacion_pct);
            return (
              <div key={m.id_ubicacion} style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    marginBottom: '4px',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{m.nombre}</span>
                  <span style={{ color: '#6b7280' }}>
                    {m.plantas_vivas.toLocaleString('es-AR')} /{' '}
                    {m.capacidad.toLocaleString('es-AR')} ·{' '}
                    <span
                      style={{
                        fontWeight: 500,
                        color:
                          nivel === 'ok'
                            ? '#059669'
                            : nivel === 'warn'
                            ? '#d97706'
                            : '#dc2626',
                      }}
                    >
                      {m.ocupacion_pct}%
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    height: '7px',
                    background: '#f3f4f6',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, m.ocupacion_pct)}%`,
                      height: '100%',
                      background:
                        nivel === 'ok'
                          ? '#10b981'
                          : nivel === 'warn'
                          ? '#d97706'
                          : '#dc2626',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {tiempos.length > 0 && (
          <div className="card">
            <p className="card-title">Tiempos promedio por fase (últimos 60 días)</p>
            <table>
              <thead>
                <tr>
                  <th>Variedad</th>
                  <th style={{ textAlign: 'right' }}>Plantinera</th>
                  <th style={{ textAlign: 'right' }}>Fase 1</th>
                  <th style={{ textAlign: 'right' }}>Fase 2</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Lotes</th>
                </tr>
              </thead>
              <tbody>
                {tiempos.map((t) => (
                  <tr key={t.variedad}>
                    <td>{t.variedad}</td>
                    <td style={{ textAlign: 'right' }}>{t.plantinera}d</td>
                    <td
                      style={{
                        textAlign: 'right',
                        color: t.fase_1 === null ? '#9ca3af' : 'inherit',
                      }}
                    >
                      {t.fase_1 === null ? '—' : `${t.fase_1}d`}
                    </td>
                    <td style={{ textAlign: 'right' }}>{t.fase_2}d</td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>
                      {t.total}d
                    </td>
                    <td style={{ textAlign: 'right', color: '#6b7280' }}>
                      {t.lotes_count}
                    </td>
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

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
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
      <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 600 }}>{value}</p>
      {sub && (
        <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>{sub}</p>
      )}
    </div>
  );
}

function ProyeccionCard({
  titulo,
  entrega,
  principal,
}: {
  titulo: string;
  entrega: any;
  principal: boolean;
}) {
  const bg = principal ? '#dbeafe' : '#f9fafb';
  const color = principal ? '#1e40af' : '#374151';
  const labelColor = principal ? '#1e40af' : '#6b7280';
  return (
    <div style={{ background: bg, borderRadius: '8px', padding: '12px 14px' }}>
      <p
        style={{
          margin: '0 0 4px',
          fontSize: '10px',
          color: labelColor,
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        {titulo}
      </p>
      <p
        style={{
          margin: '0 0 6px',
          fontSize: principal ? '18px' : '16px',
          fontWeight: 600,
          color,
        }}
      >
        {entrega.total_plantas.toLocaleString('es-AR')} plantas
      </p>
      <div style={{ fontSize: '11px', color, lineHeight: 1.6 }}>
        {entrega.lechuga_crespa > 0 && <div>L. Crespa: {entrega.lechuga_crespa}</div>}
        {entrega.lechuga_roble > 0 && <div>H. Roble: {entrega.lechuga_roble}</div>}
        {entrega.rucula_plantas > 0 && (
          <div>
            Rúcula: {entrega.rucula_plantas} (~{entrega.rucula_paquetes_aprox} paq)
          </div>
        )}
        {entrega.albahaca_plantas > 0 && (
          <div>
            Albahaca: {entrega.albahaca_plantas} (~{entrega.albahaca_paquetes_aprox} paq)
          </div>
        )}
      </div>
    </div>
  );
}
