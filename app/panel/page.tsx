// app/panel/page.tsx
// Panel principal: stats + desglose por cultivo/fase + filtros + todos los lotes.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { ocupacionPorNave } from '@/lib/ocupacion';
import {
  cosechadoEsteMes,
  plantasPorCultivo,
  variacionVsMesAnterior,
} from '@/lib/estadisticas';
import {
  aplicarFiltros,
  contarPorFiltro,
  type FiltroCultivos,
  type FiltroNave,
} from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import FiltrosLotes from '@/components/FiltrosLotes';
import LoteCard from '@/components/LoteCard';

export const dynamic = 'force-dynamic';

export default async function PanelPage({
  searchParams,
}: {
  searchParams: { filtro?: string; nave?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const filtro = (searchParams.filtro || 'todos') as FiltroCultivos;
  const nave = (searchParams.nave || 'todas') as FiltroNave;

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
  } catch { /* seguimos con arrays vacíos */ }

  // === Stats globales ===
  let cosechadoMes = 0;
  let cosechadoMesPasado = 0;
  let navesOcup: any[] = [];
  let resumenCultivos = {
    lechuga:  { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 },
    rucula:   { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 },
    albahaca: { plantinera: 0, fase_1: 0, fase_2: 0, total: 0 },
  };
  let varLechuga: number | null = null;
  let varRucula: number | null = null;

  try {
    const mes = cosechadoEsteMes(lotes);
    cosechadoMes = mes.actual;
    cosechadoMesPasado = mes.pasado;
    navesOcup = ocupacionPorNave(ubicaciones, lotes);
    resumenCultivos = plantasPorCultivo(lotes);
    varLechuga = variacionVsMesAnterior(lotes, 'lechuga');
    varRucula = variacionVsMesAnterior(lotes, 'rucula');
  } catch { /* ignore */ }

  const diferenciaPct =
    cosechadoMesPasado > 0
      ? Math.round(((cosechadoMes - cosechadoMesPasado) / cosechadoMesPasado) * 100)
      : 0;
  const ocupacionGlobal =
    navesOcup.length > 0
      ? navesOcup.reduce((acc: number, n: any) => acc + n.plantas_vivas, 0) /
        Math.max(1, navesOcup.reduce((acc: number, n: any) => acc + n.capacidad_total, 0))
      : 0;

  // === Filtros y lotes ===
  const conteos = contarPorFiltro(lotes, nave);
  const lotesFiltrados = aplicarFiltros(lotes, filtro, nave);

  const hoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <>
      <Header user={user} current="panel" />
      <div className="container">
        <h1 className="page-title">Panel de control</h1>
        <p className="page-subtitle">
          {hoy.charAt(0).toUpperCase() + hoy.slice(1)} · Bienvenido, {user.nombre}
        </p>

        {/* === DESGLOSE POR CULTIVO Y FASE === */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          {/* Lechuga */}
          <CultivoCarda
            titulo="Lechuga"
            color="#4d7c0f"
            colorBg="#f7fee7"
            datos={resumenCultivos.lechuga}
            variacion={varLechuga}
            tieneFase1
          />

          {/* Rúcula */}
          <CultivoCarda
            titulo="Rúcula"
            color="#166534"
            colorBg="#dcfce7"
            datos={resumenCultivos.rucula}
            variacion={varRucula}
            tieneFase1={false}
          />

          {/* Ocupación + cosechas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', flex: 1 }}>
              <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                Ocupación global
              </p>
              <p style={{ margin: '0 0 4px', fontSize: '26px', fontWeight: 700 }}>
                {Math.round(ocupacionGlobal * 100)}%
              </p>
              <div style={{ fontSize: '11px', color: '#6b7280', lineHeight: 1.7 }}>
                {navesOcup.map((n: any) => (
                  <div key={n.nave}>
                    Nave {n.nave}: <strong style={{ color: '#1f2937' }}>{n.ocupacion_pct}%</strong>
                    <span style={{ color: '#9ca3af' }}> · {n.densidad_actual} pl/m²</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', flex: 1 }}>
              <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                Cosechado este mes
              </p>
              <p style={{ margin: '0 0 4px', fontSize: '26px', fontWeight: 700 }}>
                {cosechadoMes.toLocaleString('es-AR')}
              </p>
              {cosechadoMesPasado > 0 && (
                <p style={{ margin: 0, fontSize: '12px', color: diferenciaPct >= 0 ? '#059669' : '#dc2626', fontWeight: 500 }}>
                  {diferenciaPct >= 0 ? '↑' : '↓'} {Math.abs(diferenciaPct)}% vs mes anterior
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Acciones rápidas */}
        <div className="card">
          <p className="card-title">Acciones rápidas</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Link href="/cultivos/nuevo" className="btn">+ Nuevo lote</Link>
            <Link href="/ocupacion" className="btn secondary">Ocupación</Link>
            <Link href="/estadisticas" className="btn secondary">Estadísticas</Link>
          </div>
        </div>

        {/* Lotes con filtros */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Cultivos activos
            {filtro !== 'todos' || nave !== 'todas'
              ? ` — ${lotesFiltrados.length} de ${conteos.todos}`
              : ` (${conteos.todos})`}
          </h2>
        </div>

        <FiltrosLotes
          filtroActivo={filtro}
          naveActiva={nave}
          conteos={conteos}
          baseUrl="/panel"
        />

        {lotesFiltrados.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ margin: 0, color: '#6b7280' }}>
              No hay lotes para mostrar con este filtro.
            </p>
            <Link href="/cultivos/nuevo" className="btn" style={{ marginTop: '14px', display: 'inline-block' }}>
              + Crear lote
            </Link>
          </div>
        ) : (
          lotesFiltrados.map((lote) => (
            <LoteCard
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

// === Componente de card por cultivo ===
function CultivoCarda({
  titulo,
  color,
  colorBg,
  datos,
  variacion,
  tieneFase1,
}: {
  titulo: string;
  color: string;
  colorBg: string;
  datos: { plantinera: number; fase_1: number; fase_2: number; total: number };
  variacion: number | null;
  tieneFase1: boolean;
}) {
  const varColor =
    variacion === null ? '#9ca3af' :
    variacion > 0 ? '#059669' : '#dc2626';

  return (
    <div
      style={{
        background: 'white',
        border: `1px solid #e5e7eb`,
        borderTop: `3px solid ${color}`,
        borderRadius: '10px',
        padding: '16px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span
          style={{
            background: color,
            color: 'white',
            padding: '2px 10px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 800,
            letterSpacing: '0.5px',
          }}
        >
          {titulo.toUpperCase()}
        </span>
        <span style={{ fontSize: '22px', fontWeight: 700, color: '#111827' }}>
          {datos.total.toLocaleString('es-AR')}
          <span style={{ fontSize: '11px', fontWeight: 400, color: '#6b7280', marginLeft: '4px' }}>plantas</span>
        </span>
      </div>

      {/* Desglose por fase */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: tieneFase1 ? '1fr 1fr 1fr' : '1fr 1fr',
          gap: '6px',
          marginBottom: '10px',
        }}
      >
        <FaseStat label="Plantinera" valor={datos.plantinera} colorBg={colorBg} color={color} />
        {tieneFase1 && (
          <FaseStat label="Fase 1" valor={datos.fase_1} colorBg={colorBg} color={color} />
        )}
        <FaseStat label="Fase 2" valor={datos.fase_2} colorBg={colorBg} color={color} />
      </div>

      {/* Variación */}
      <div
        style={{
          paddingTop: '10px',
          borderTop: '1px solid #f3f4f6',
          fontSize: '12px',
          color: varColor,
          fontWeight: 500,
        }}
      >
        {variacion === null ? (
          <span style={{ color: '#9ca3af', fontWeight: 400 }}>Sin datos del mes anterior</span>
        ) : (
          <>
            {variacion >= 0 ? '↑' : '↓'} {Math.abs(variacion)}% vs cosechas mes anterior
          </>
        )}
      </div>
    </div>
  );
}

function FaseStat({
  label,
  valor,
  colorBg,
  color,
}: {
  label: string;
  valor: number;
  colorBg: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: valor > 0 ? colorBg : '#f9fafb',
        borderRadius: '6px',
        padding: '8px 10px',
        textAlign: 'center',
      }}
    >
      <p style={{ margin: '0 0 2px', fontSize: '10px', color: valor > 0 ? color : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 600 }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: valor > 0 ? '#111827' : '#d1d5db' }}>
        {valor.toLocaleString('es-AR')}
      </p>
    </div>
  );
}
