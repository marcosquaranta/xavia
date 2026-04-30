// app/cultivos/page.tsx
// Mis Cultivos: lista de lotes con filtros por variedad+fase.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import {
  aplicarFiltroCultivos,
  calcularDiasPorFase,
  claseVariedad,
  contarPorFiltro,
  estimarPlantasActuales,
  type FiltroCultivos,
} from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

const FILTROS: { key: FiltroCultivos; label: string; color: string }[] = [
  { key: 'todos', label: 'Todos', color: 'verde' },
  { key: 'lechugas-f2', label: 'Lechugas F2', color: 'lechuga' },
  { key: 'lechugas-f1', label: 'Lechugas F1', color: 'lechuga' },
  { key: 'lechugas-plantin', label: 'Lechugas Plantín', color: 'lechuga' },
  { key: 'rucula-f2', label: 'Rúculas', color: 'rucula' },
  { key: 'rucula-plantin', label: 'Rúculas Plantín', color: 'rucula' },
  { key: 'albahaca', label: 'Albahacas', color: 'albahaca' },
  { key: 'cosechados', label: 'Cosechados', color: 'gris' },
];

export default async function CultivosPage({
  searchParams,
}: {
  searchParams: { filtro?: FiltroCultivos };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const filtro = (searchParams.filtro || 'todos') as FiltroCultivos;

  const [lotes, movimientos, ubicaciones, variedades] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Movimiento>('Movimientos'),
    readSheet<Ubicacion>('Ubicaciones'),
    readSheet<Variedad>('Variedades'),
  ]);

  const conteos = contarPorFiltro(lotes);
  const lotesFiltrados = aplicarFiltroCultivos(lotes, filtro);
  const totalActivos = conteos.todos;

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

        <div
          style={{
            display: 'flex',
            gap: '6px',
            flexWrap: 'wrap',
            marginBottom: '14px',
          }}
        >
          {FILTROS.map((f) => {
            const count = conteos[f.key];
            const isActive = filtro === f.key;
            return (
              <Link
                key={f.key}
                href={`/cultivos?filtro=${f.key}`}
                style={{ textDecoration: 'none' }}
              >
                <span className="pill" style={pillStyle(f.color, isActive)}>
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

function pillStyle(color: string, active: boolean): React.CSSProperties {
  if (active) {
    return { background: '#059669', color: 'white', cursor: 'pointer' };
  }
  if (color === 'lechuga') {
    return {
      background: '#f7fee7',
      color: '#4d7c0f',
      border: '1px solid #bef264',
      cursor: 'pointer',
    };
  }
  if (color === 'rucula') {
    return {
      background: '#dcfce7',
      color: '#166534',
      border: '1px solid #86efac',
      cursor: 'pointer',
    };
  }
  if (color === 'albahaca') {
    return {
      background: '#d1fae5',
      color: '#047857',
      border: '1px solid #6ee7b7',
      cursor: 'pointer',
    };
  }
  if (color === 'gris') {
    return {
      background: '#f3f4f6',
      color: '#6b7280',
      border: '1px solid #e5e7eb',
      cursor: 'pointer',
    };
  }
  return {
    background: 'white',
    color: '#374151',
    border: '1px solid #e5e7eb',
    cursor: 'pointer',
  };
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
  const dias = calcularDiasPorFase(lote, movimientos);
  const plantasEstimadas = estimarPlantasActuales(lote, ubicaciones);
  const variedad = variedades.find((v) => v.variedad === lote.variedad);

  const labelFase =
    lote.fase_actual === 'plantin'
      ? 'Plantín'
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <span className="lote-id">{lote.id_lote}</span>
            <span style={{ fontWeight: 500, fontSize: '14px' }}>{lote.variedad}</span>
            <span className={`pill ${claseFase}`}>{labelFase}</span>
            {lote.destino_cosecha === 'bandeja' && (
              <span style={{ fontSize: '11px', color: '#166534', fontStyle: 'italic' }}>
                (destino: bandeja)
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6b7280' }}>
            {lote.ubicacion_actual || `Plantinera Nave ${lote.id_lote.charAt(1)}`} ·{' '}
            {plantasEstimadas > 0
              ? `~${plantasEstimadas} plantas`
              : `${lote.plantines_iniciales} plantines`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {lote.estado === 'activo' && (
            <Link href={accionHref} className="btn secondary small">
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
          borderTop: '1px solid #e5e7eb',
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
            <span style={{ color: '#6b7280' }}>Fase 1:</span>{' '}
            <strong>{dias.fase_1}d</strong>
          </span>
        )}
        {dias.fase_2 > 0 && (
          <span>
            <span style={{ color: '#6b7280' }}>Fase 2:</span>{' '}
            <strong>{dias.fase_2}d</strong>
          </span>
        )}
        {variedad && (
          <span style={{ marginLeft: 'auto', color: '#6b7280' }}>
            ciclo estimado: {variedad.dias_estimados_cosecha}d
          </span>
        )}
      </div>
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
