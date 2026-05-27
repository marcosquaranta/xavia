import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { aplicarFiltros3, contarPorFiltro, type FiltroCultivo, type FiltroFase, type FiltroNave } from '@/lib/lotes';
import { cicloRealPorVariedad } from '@/lib/estadisticas';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import FiltrosLotes from '@/components/FiltrosLotes';
import LoteCard from '@/components/LoteCard';
import BuscadorLote from '@/components/BuscadorLote';

export const dynamic = 'force-dynamic';

export default async function CultivosPage({
  searchParams,
}: {
  searchParams: { cultivo?: string; fase?: string; nave?: string; q?: string; orden?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const cultivo = (searchParams.cultivo || 'todos') as FiltroCultivo;
  const fase = (searchParams.fase || 'todas') as FiltroFase;
  const nave = (searchParams.nave || 'todas') as FiltroNave;
  const query = (searchParams.q || '').trim().toLowerCase();
  const orden = searchParams.orden === 'desc' ? 'desc' : 'asc';

  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [], variedades: Variedad[] = [];
  let err: string | null = null;
  try {
    [lotes, movimientos, ubicaciones, variedades] = await Promise.all([
      readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'),
      readSheet<Ubicacion>('Ubicaciones'), readSheet<Variedad>('Variedades'),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }

  if (err) return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const conteos = contarPorFiltro(lotes, nave);

  // Si hay búsqueda por ID, buscar en todos los lotes (activos y cosechados)
  // Ciclo real basado en cosechados recientes
  const ciclosReales = cicloRealPorVariedad(lotes, movimientos, 5);

  let lotesFiltrados: Lote[];
  if (query) {
    lotesFiltrados = lotes.filter((l) =>
      String(l.id_lote || '').toLowerCase().includes(query)
    );
  } else {
    lotesFiltrados = aplicarFiltros3(lotes, cultivo, fase, nave);
  }

  // Ordenar por fecha de siembra
  lotesFiltrados = [...lotesFiltrados].sort((a, b) => {
    const fa = String(a.fecha_siembra || '');
    const fb = String(b.fecha_siembra || '');
    return orden === 'asc' ? fa.localeCompare(fb) : fb.localeCompare(fa);
  });

  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <h1 className="page-title">Mis cultivos</h1>
            <p className="page-subtitle" style={{ marginBottom: 0 }}>{conteos.todos} lotes activos</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Link
              href={`/cultivos?${new URLSearchParams({ ...(cultivo !== 'todos' ? { cultivo } : {}), ...(fase !== 'todas' ? { fase } : {}), ...(nave !== 'todas' ? { nave } : {}), orden: orden === 'asc' ? 'desc' : 'asc' }).toString()}`}
              className="btn secondary"
              style={{ fontSize: '12px' }}
            >
              {orden === 'asc' ? '↑ Más viejos primero' : '↓ Más nuevos primero'}
            </Link>
            <Link href="/cultivos/nuevo" className="btn">+ Nuevo lote</Link>
          </div>
        </div>

        {/* Buscador */}
        <BuscadorLote baseUrl="/cultivos" />

        {/* Filtros — se ocultan cuando hay búsqueda activa */}
        {!query && (
          <FiltrosLotes cultivoActivo={cultivo} faseActiva={fase} naveActiva={nave} conteos={conteos} baseUrl="/cultivos" />
        )}

        {/* Resultados */}
        {query && (
          <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
            {lotesFiltrados.length === 0
              ? `Sin resultados para "${searchParams.q}"`
              : `${lotesFiltrados.length} resultado${lotesFiltrados.length > 1 ? 's' : ''} para "${searchParams.q}"`}
          </p>
        )}

        {lotesFiltrados.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ margin: 0, color: '#6b7280' }}>
              {query ? `No se encontró el lote "${searchParams.q}"` : 'No hay lotes con este filtro.'}
            </p>
            {!query && (
              <Link href="/cultivos/nuevo" className="btn" style={{ marginTop: '16px', display: 'inline-block' }}>
                + Crear lote
              </Link>
            )}
          </div>
        ) : (
          lotesFiltrados.map((lote) => (
            <LoteCard key={lote.id_lote} lote={lote} movimientos={movimientos} ubicaciones={ubicaciones} variedades={variedades} ciclosReales={ciclosReales} />
          ))
        )}
      </div>
    </>
  );
}
