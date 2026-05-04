// app/cultivos/page.tsx
// Mis Cultivos: lista de lotes con filtros por fase, variedad y nave.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import {
  aplicarFiltros,
  calcularDiasPorFase,
  claseVariedad,
  contarPorFiltro,
  estimarPlantasActuales,
  naveDeLote,
  type FiltroCultivos,
  type FiltroNave,
} from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

// Grupos de pills por fase (más simple que por variedad+fase)
const FILTROS_FASE: { key: FiltroCultivos; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'plantinera', label: 'Plantinera' },
  { key: 'fase_1', label: 'F1' },
  { key: 'fase_2', label: 'F2' },
  { key: 'cosechados', label: 'Cosechados' },
];

export default async function CultivosPage({
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
  let errorLectura: string | null = null;

  try {
    [lotes, movimientos, ubicaciones, variedades] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'),
      readSheet<Variedad>('Variedades'),
    ]);
  } catch (err: any) {
    errorLectura = err?.message || 'Error al leer datos';
  }

  if (errorLectura) {
    return (
      <>
        <Header user={user} current="cultivos" />
        <div className="container">
          <div className="alert-box error">{errorLectura}</div>
        </div>
      </>
    );
  }

  const conteos = contarPorFiltro(lotes, nave);
  const lotesFiltrados = aplicarFiltros(lotes, filtro, nave);
  const totalActivos = contarPorFiltro(lotes, 'todas').todos;

  function buildUrl(nuevoFiltro: string, nuevaNave: string) {
    const params = new URLSearchParams();
    if (nuevoFiltro !== 'todos') params.set('filtro', nuevoFiltro);
    if (nuevaNave !== 'todas') params.set('nave', nuevaNave);
    const str = params.toString();
    return `/cultivos${str ? `?${str}` : ''}`;
  }

  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '14px',
          }}
        >
          <div>
            <h1 className="page-title">Mis cultivos</h1>
            <p className="page-subtitle" style={{ marginBottom: 0 }}>
              {totalActivos} lotes activos
            </p>
          </div>
          <Link href="/cultivos/nuevo" className="btn">
            + Nuevo lote
          </Link>
        </div>

        {/* Filtro por nave */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
          {(['todas', '1', '2'] as FiltroNave[]).map((n) => {
            const isActive = nave === n;
            return (
              <Link
                key={n}
                href={buildUrl(filtro, n)}
                style={{ textDecoration: 'none' }}
              >
                <span
                  className="pill"
                  style={{
                    background: isActive ? '#111827' : '#f3f4f6',
                    color: isActive ? 'white' : '#374151',
                    border: '1px solid',
                    borderColor: isActive ? '#111827' : '#e5e7eb',
                    cursor: 'pointer',
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {n === 'todas' ? 'Ambas naves' : `Nave ${n}`}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Filtro por fase */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
          {FILTROS_FASE.map((f) => {
            const count = conteos[f.key];
            const isActive = filtro === f.key;
            return (
              <Link
                key={f.key}
                href={buildUrl(f.key, nave)}
                style={{ textDecoration: 'none' }}
              >
                <span
                  className="pill"
                  style={{
                    background: isActive ? '#059669' : 'white',
                    color: isActive ? 'white' : '#374151',
                    border: '1px solid',
                    borderColor: isActive ? '#059669' : '#e5e7eb',
                    cursor: 'pointer',
                  }}
                >
                  {f.label} ({count})
                </span>
              </Link>
            );
          })}
        </div>

        {lotesFiltrados.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ margin: 0, color: '#6b7280' }}>
              No hay lotes para mostrar con este filtro.
            </p>
            <Link
              href="/cultivos/nuevo"
              className="btn"
              style={{ marginTop: '16px', display: 'inline-block' }}
            >
              + Crear el primer lote
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

function LoteCard({
  lote,
  movimientos,
  ubicaciones,
  variedades,
}: {
  lote: Lote;
  movimientos: Movimiento[];
  ubicaciones: Ubicacion[];
  variedades: Variedad[];
}) {
  let dias;
  try {
    dias = calcularDiasPorFase(lote, movimientos);
  } catch {
    dias = { plantinera: 0, fase_1: null, fase_2: 0, total: 0, fechas: { siembra: '', fase_1_inicio: null, fase_2_inicio: null, cosecha: null } };
  }

  const plantasEstimadas = estimarPlantasActuales(lote, ubicaciones);
  const variedad = variedades.find((v) => v.variedad === lote.variedad);
  const naveNum = naveDeLote(lote.id_lote);

  const labelFase =
    lote.fase_actual === 'plantin'
      ? 'Plantinera'
      : lote.fase_actual === 'fase_1'
      ? 'Fase 1'
      : 'Fase 2';
  const claseFase =
    lote.fase_actual === 'plantin'
      ? 'plantin'
      : lote.fase_actual === 'fase_1'
      ? 'fase1'
      : 'fase2';

  let accionLabel = 'Trasplantar';
  let accionHref = `/cultivos/${encodeURIComponent(lote.id_lote)}/trasplantar`;
  if (lote.fase_actual === 'fase_2') {
    accionLabel = 'Cosechar';
    accionHref = `/cultivos/${encodeURIComponent(lote.id_lote)}/cosechar`;
  } else if (lote.fase_actual === 'fase_1') {
    accionLabel = 'Pasar a F2';
  }

  // Extraer nave y mesada de ubicacion_actual para destacarla
  const ubicStr = String(lote.ubicacion_actual || '');

  return (
    <div className={`lote-row ${claseVariedad(lote)}`}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '8px',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Nave + Mesada destacados */}
          {ubicStr && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '6px',
              }}
            >
              {naveNum && (
                <span
                  style={{
                    background: naveNum === 1 ? '#1e40af' : '#7c3aed',
                    color: 'white',
                    padding: '2px 10px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                  }}
                >
                  NAVE {naveNum}
                </span>
              )}
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#1f2937',
                }}
              >
                {ubicStr.replace(/^Nave \d+ - /, '')}
              </span>
            </div>
          )}

          {/* ID + variedad + fase */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '12px',
                color: '#6b7280',
              }}
            >
              Nro Lote: {lote.id_lote}
            </span>
            <span style={{ fontWeight: 500, fontSize: '14px' }}>{lote.variedad}</span>
            <span className={`pill ${claseFase}`}>{labelFase}</span>
            {lote.destino_cosecha === 'bandeja' && (
              <span style={{ fontSize: '11px', color: '#166534', fontStyle: 'italic' }}>
                (destino: bandeja)
              </span>
            )}
          </div>

          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6b7280' }}>
            {plantasEstimadas > 0
              ? `~${plantasEstimadas} plantas`
              : `${lote.plantines_iniciales} plantines`}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {lote.estado === 'activo' && (
            <Link href={accionHref} className="btn small">
              {accionLabel}
            </Link>
          )}
          <Link
            href={`/cultivos/${encodeURIComponent(lote.id_lote)}`}
            className="btn secondary small"
          >
            Ver
          </Link>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '14px',
          fontSize: '11px',
          paddingTop: '8px',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          flexWrap: 'wrap',
        }}
      >
        <span>
          <span style={{ color: '#6b7280' }}>Sembrado:</span>{' '}
          {formatearFecha(dias.fechas.siembra)} · <strong>{dias.total}d</strong>
        </span>
        <span>
          <span style={{ color: '#6b7280' }}>Plantinera:</span>{' '}
          <strong>{dias.plantinera}d</strong>
        </span>
        {dias.fase_1 !== null && (
          <span>
            <span style={{ color: '#6b7280' }}>F1:</span>{' '}
            <strong>{dias.fase_1}d</strong>
          </span>
        )}
        {dias.fase_2 > 0 && (
          <span>
            <span style={{ color: '#6b7280' }}>F2:</span>{' '}
            <strong>{dias.fase_2}d</strong>
          </span>
        )}
        {variedad && (
          <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>
            ciclo est. {variedad.dias_estimados_cosecha}d
          </span>
        )}
      </div>
    </div>
  );
}

function formatearFecha(fecha: string): string {
  if (!fecha) return '-';
  try {
    const partes = String(fecha).split('-');
    if (partes.length !== 3) return fecha;
    const [, m, d] = partes;
    return `${d}/${m}`;
  } catch {
    return fecha;
  }
}
