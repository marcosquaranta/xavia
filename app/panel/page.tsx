// app/panel/page.tsx
// Panel principal: stats + todos los lotes activos directamente.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorNave } from '@/lib/ocupacion';
import {
  cosechaSemanaActual,
  cosechadoEsteMes,
} from '@/lib/estadisticas';
import {
  calcularDiasPorFase,
  claseVariedad,
  estimarPlantasActuales,
  naveDeLote,
} from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

export default async function PanelPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let lotes: Lote[] = [];
  let movimientos: Movimiento[] = [];
  let ubicaciones: Ubicacion[] = [];
  let variedades: Variedad[] = [];

  try {
    [lotes, movimientos, ubicaciones, variedades] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'),
      readSheet<Variedad>('Variedades'),
    ]);
  } catch {
    // Si falla, seguimos con arrays vacíos — el panel muestra datos parciales
  }

  const lotesActivos = lotes.filter((l) => l.estado === 'activo');
  const totalPlantasActivas = lotesActivos.reduce(
    (acc, l) =>
      acc +
      (Number(l.plantas_estimadas_actual) || Number(l.plantines_iniciales) || 0),
    0
  );

  let cosechaSem = { lechuga_crespa: 0, lechuga_roble: 0, rucula_paquetes: 0, albahaca_paquetes: 0 };
  let cosechadoMes = 0;
  let cosechadoMesPasado = 0;
  let navesOcup: any[] = [];
  try {
    cosechaSem = cosechaSemanaActual(lotes);
    const mes = cosechadoEsteMes(lotes);
    cosechadoMes = mes.actual;
    cosechadoMesPasado = mes.pasado;
    navesOcup = ocupacionPorNave(ubicaciones, lotes);
  } catch {
    // ignore
  }

  const diferenciaPct =
    cosechadoMesPasado > 0
      ? Math.round(
          ((cosechadoMes - cosechadoMesPasado) / cosechadoMesPasado) * 100
        )
      : 0;

  const ocupacionGlobal =
    navesOcup.length > 0
      ? navesOcup.reduce((acc: number, n: any) => acc + n.plantas_vivas, 0) /
        Math.max(1, navesOcup.reduce((acc: number, n: any) => acc + n.capacidad_total, 0))
      : 0;

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

        {/* Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
            sub={navesOcup.map((n: any) => `N${n.nave}: ${n.ocupacion_pct}%`).join(' · ')}
          />
          <Stat
            label="Cosechado este mes"
            value={cosechadoMes.toLocaleString('es-AR')}
            sub={
              cosechadoMesPasado > 0
                ? `${diferenciaPct >= 0 ? '↑' : '↓'} ${Math.abs(diferenciaPct)}% vs mes ant.`
                : 'sin datos mes anterior'
            }
            subColor={diferenciaPct >= 0 ? '#059669' : '#dc2626'}
          />
        </div>

        {/* Acciones rápidas */}
        <div className="card">
          <p className="card-title">Acciones rápidas</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Link href="/cultivos/nuevo" className="btn">
              + Nuevo lote
            </Link>
            <Link href="/ocupacion" className="btn secondary">
              Ocupación
            </Link>
            <Link href="/estadisticas" className="btn secondary">
              Estadísticas
            </Link>
          </div>
        </div>

        {/* Todos los lotes activos */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Cultivos activos ({lotesActivos.length})
          </h2>
          <Link href="/cultivos" style={{ fontSize: '12px', color: '#059669' }}>
            Ver con filtros →
          </Link>
        </div>

        {lotesActivos.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ margin: 0, color: '#6b7280' }}>No hay lotes activos todavía.</p>
            <Link href="/cultivos/nuevo" className="btn" style={{ marginTop: '14px', display: 'inline-block' }}>
              + Crear primer lote
            </Link>
          </div>
        ) : (
          lotesActivos.map((lote) => (
            <LoteCardCompacta
              key={lote.id_lote}
              lote={lote}
              movimientos={movimientos}
              ubicaciones={ubicaciones}
              variedades={variedades}
            />
          ))
        )}
      </div>
    </>
  );
}

function Stat({ label, value, sub, subColor }: { label: string; value: string | number; sub?: string; subColor?: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
      <p style={{ margin: 0, fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</p>
      <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 600 }}>{value}</p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: '11px', color: subColor || '#6b7280' }}>{sub}</p>}
    </div>
  );
}

function StatCosecha({ cosecha }: { cosecha: any }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
      <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
        Cosecha esta semana
      </p>
      <div style={{ fontSize: '12px', lineHeight: 1.7 }}>
        <div style={{ color: '#4d7c0f' }}>Lech. Crespa: <strong>{cosecha.lechuga_crespa}</strong></div>
        <div style={{ color: '#4d7c0f' }}>H. Roble: <strong>{cosecha.lechuga_roble}</strong></div>
        <div style={{ color: '#166534' }}>Rúcula: <strong>{cosecha.rucula_paquetes}</strong> paq.</div>
        <div style={{ color: '#047857' }}>Albahaca: <strong>{cosecha.albahaca_paquetes}</strong> paq.</div>
      </div>
    </div>
  );
}

function LoteCardCompacta({ lote, movimientos, ubicaciones, variedades }: { lote: Lote; movimientos: Movimiento[]; ubicaciones: Ubicacion[]; variedades: Variedad[] }) {
  let dias;
  try {
    dias = calcularDiasPorFase(lote, movimientos);
  } catch {
    dias = { plantinera: 0, fase_1: null, fase_2: 0, total: 0, fechas: { siembra: '', fase_1_inicio: null, fase_2_inicio: null, cosecha: null } };
  }
  const plantasEst = estimarPlantasActuales(lote, ubicaciones);
  const naveNum = naveDeLote(lote.id_lote);
  const ubicStr = String(lote.ubicacion_actual || '');

  const labelFase = lote.fase_actual === 'plantin' ? 'Plantinera' : lote.fase_actual === 'fase_1' ? 'Fase 1' : 'Fase 2';
  const claseFase = lote.fase_actual === 'plantin' ? 'plantin' : lote.fase_actual === 'fase_1' ? 'fase1' : 'fase2';

  let accionLabel = 'Trasplantar';
  let accionHref = `/cultivos/${encodeURIComponent(lote.id_lote)}/trasplantar`;
  if (lote.fase_actual === 'fase_2') { accionLabel = 'Cosechar'; accionHref = `/cultivos/${encodeURIComponent(lote.id_lote)}/cosechar`; }
  else if (lote.fase_actual === 'fase_1') { accionLabel = 'Pasar a F2'; }

  return (
    <div className={`lote-row ${claseVariedad(lote)}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {ubicStr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              {naveNum && (
                <span style={{ background: naveNum === 1 ? '#1e40af' : '#7c3aed', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                  NAVE {naveNum}
                </span>
              )}
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#1f2937' }}>
                {ubicStr.replace(/^Nave \d+ - /, '')}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#9ca3af' }}>Nro Lote: {lote.id_lote}</span>
            <span style={{ fontWeight: 500, fontSize: '13px' }}>{lote.variedad}</span>
            <span className={`pill ${claseFase}`}>{labelFase}</span>
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#6b7280' }}>
            {plantasEst > 0 ? `~${plantasEst} plantas` : `${lote.plantines_iniciales || 0} plantines`}
            {' · '}{dias.total}d desde siembra
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <Link href={accionHref} className="btn small">{accionLabel}</Link>
          <Link href={`/cultivos/${encodeURIComponent(lote.id_lote)}`} className="btn secondary small">Ver</Link>
        </div>
      </div>
    </div>
  );
}

function formatearFecha(fecha: string): string {
  if (!fecha) return '-';
  try {
    const [, m, d] = String(fecha).split('-');
    return `${d}/${m}`;
  } catch { return fecha; }
}
