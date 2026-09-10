import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { aplicarFiltros3,  contarPorFiltro, type FiltroCultivo, type FiltroFase, type FiltroNave } from '@/lib/lotes';
import { cicloRealPorVariedad } from '@/lib/estadisticas';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import FiltrosLotes from '@/components/FiltrosLotes';
import LoteCard from '@/components/LoteCard';
import BuscadorLote from '@/components/BuscadorLote';
import ActividadReciente, { type MovResumen } from '@/components/ActividadReciente';

export const dynamic = 'force-dynamic';

export default async function CultivosPage({
  searchParams,
}: {
  searchParams: { cultivo?: string; fase?: string; nave?: string; mesada?: string; tiempo?: string; q?: string; orden?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const cultivo = (searchParams.cultivo || 'todos') as FiltroCultivo;
  const fase = (searchParams.fase || 'todas') as FiltroFase;
  const nave = (searchParams.nave || 'todas') as FiltroNave;
  const mesada = searchParams.mesada || 'todas';
  const tiempo = (searchParams.tiempo || 'todos') as any;
  const query = (searchParams.q || '').trim().toLowerCase();
  const orden = searchParams.orden === 'asc' ? 'asc' : 'desc';

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

  const conteos = contarPorFiltro(lotes, nave, ubicaciones);

  // ── Actividad de los últimos días (la vieja sección "Actividad" del menú) ──
  // Se arma acá, en el server, con los lotes que la página ya tenía cargados: el componente
  // recibe solo lo que muestra, en vez de mandarle Lotes y Movimientos enteros al browser.
  const DIAS_ACTIVIDAD = 7;
  const limiteActividad = new Date();
  limiteActividad.setDate(limiteActividad.getDate() - DIAS_ACTIVIDAD);
  const lotesPorId = new Map(lotes.map((l) => [l.id_lote, l]));
  const fmtFase = (f: any) => String(f || '').replace('fase_', 'F').replace('plantin', 'Plant.');
  const actividad: MovResumen[] = movimientos
    .filter((m) => {
      const f = String(m.fecha || '').split(/[\sT]/)[0];
      if (!f) return false;
      try { return new Date(f + 'T12:00:00') >= limiteActividad; } catch { return false; }
    })
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
    .map((m) => {
      const lote = lotesPorId.get(String(m.id_lote || ''));
      const varNorm = String(lote?.variedad || '').toLowerCase();
      const esRucula = varNorm.includes('rucula') || varNorm.includes('rúcula');
      // Igual que en /movimientos: en una cosecha la cantidad real está en
      // unidades_cosechadas, no en plantas_estimadas (esa quedó de la siembra).
      const cosechado = Number(m.unidades_cosechadas || 0);
      const estimado = Number(m.plantas_estimadas || 0);
      const cantidad = m.tipo === 'cosecha' && esRucula && cosechado > 0
        ? `${cosechado.toLocaleString('es-AR')} paq. (${estimado.toLocaleString('es-AR')} pl)`
        : m.tipo === 'cosecha' && cosechado > 0 ? `${cosechado.toLocaleString('es-AR')} pl`
        : m.tipo === 'division' && estimado > 0 ? `${estimado.toLocaleString('es-AR')} quedan`
        : estimado > 0 ? `${estimado.toLocaleString('es-AR')} pl` : '';
      return {
        id: String(m.id_movimiento),
        tipo: String(m.tipo || ''),
        fecha: String(m.fecha || '').split(/[\sT]/)[0],
        lote: String(m.id_lote || ''),
        variedad: String(lote?.variedad || '').split(' ').slice(0, 2).join(' '),
        esRucula,
        cantidad,
        usuario: String(m.usuario || '').split('@')[0] || '—',
        ubicacion: String(m.ubicacion_destino || '').replace('Nave 1 - ', '').replace('Nave 2 - ', ''),
        fases: m.tipo === 'trasplante' ? `${fmtFase(m.fase_origen)} → ${fmtFase(m.fase_destino)}` : '',
        notas: m.tipo === 'division' ? String(m.notas || '') : '',
      };
    });

  // Si hay búsqueda por ID, buscar en todos los lotes (activos y cosechados)
  // Ciclo real basado en cosechados recientes
  const ciclosReales = cicloRealPorVariedad(lotes, movimientos, 5);

  let lotesFiltrados: Lote[];
  if (query) {
    lotesFiltrados = lotes.filter((l) =>
      String(l.id_lote || '').toLowerCase().includes(query)
    );
  } else {
    lotesFiltrados = aplicarFiltros3(lotes, cultivo, fase, nave, mesada, tiempo, ubicaciones);
  }

  // Ordenar por último movimiento (fecha_ult_movimiento > fecha_cosecha > fecha_siembra)
  lotesFiltrados = [...lotesFiltrados].sort((a, b) => {
    const fa = String(a.fecha_ult_movimiento || a.fecha_cosecha || a.fecha_siembra || '');
    const fb = String(b.fecha_ult_movimiento || b.fecha_cosecha || b.fecha_siembra || '');
    return orden === 'asc' ? fa.localeCompare(fb) : fb.localeCompare(fa);
  });

  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <h1 className="page-title">Mis cultivos</h1>
            <p className="page-subtitle" style={{ marginBottom: 0 }}>{fase === 'borrados' ? `${conteos.borrados} lotes borrados` : `${conteos.todos} lotes activos`}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Link
              href={`/cultivos?${new URLSearchParams({ ...(cultivo !== 'todos' ? { cultivo } : {}), ...(fase !== 'todas' ? { fase } : {}), ...(nave !== 'todas' ? { nave } : {}), orden: orden === 'asc' ? 'desc' : 'asc' }).toString()}`}
              className="btn secondary"
              style={{ fontSize: '12px' }}
            >
              {orden === 'desc' ? '↓ Más nuevos primero' : '↑ Más viejos primero'}
            </Link>
            <Link href="/cultivos/nuevo" className="btn">+ Nuevo lote</Link>
          </div>
        </div>

        <ActividadReciente movimientos={actividad} dias={DIAS_ACTIVIDAD} />

        {/* Buscador */}
        <BuscadorLote baseUrl="/cultivos" />

        {/* Filtros — se ocultan cuando hay búsqueda activa */}
        {!query && (
          <FiltrosLotes cultivoActivo={cultivo} faseActiva={fase} naveActiva={nave} mesadaActiva={mesada} tiempoActivo={tiempo} conteos={conteos} ubicaciones={ubicaciones} baseUrl="/cultivos" esAdmin={user.rol === 'admin'} />
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
            <LoteCard key={lote.id_lote} lote={lote} movimientos={movimientos} ubicaciones={ubicaciones} variedades={variedades} ciclosReales={ciclosReales} esAdmin={user.rol === 'admin'} />
          ))
        )}
      </div>
    </>
  );
}
