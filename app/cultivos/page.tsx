import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { aplicarFiltros, contarPorFiltro, type FiltroCultivos, type FiltroNave } from '@/lib/lotes';
import type { Lote, Movimiento, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import FiltrosLotes from '@/components/FiltrosLotes';
import LoteCard from '@/components/LoteCard';
export const dynamic = 'force-dynamic';
export default async function CultivosPage({ searchParams }: { searchParams: { filtro?: string; nave?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const filtro = (searchParams.filtro || 'todos') as FiltroCultivos;
  const nave = (searchParams.nave || 'todas') as FiltroNave;
  let lotes: Lote[] = [], movimientos: Movimiento[] = [], ubicaciones: Ubicacion[] = [], variedades: Variedad[] = [];
  let err: string | null = null;
  try { [lotes, movimientos, ubicaciones, variedades] = await Promise.all([readSheet<Lote>('Lotes'), readSheet<Movimiento>('Movimientos'), readSheet<Ubicacion>('Ubicaciones'), readSheet<Variedad>('Variedades')]); } catch (e: any) { err = e?.message || 'Error'; }
  if (err) return <><Header user={user} current="cultivos" /><div className="container"><div className="alert-box error">{err}</div></div></>;
  const conteos = contarPorFiltro(lotes, nave);
  const lotesFiltrados = aplicarFiltros(lotes, filtro, nave);
  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div><h1 className="page-title">Mis cultivos</h1><p className="page-subtitle" style={{ marginBottom: 0 }}>{conteos.todos} lotes activos</p></div>
          <Link href="/cultivos/nuevo" className="btn">+ Nuevo lote</Link>
        </div>
        <FiltrosLotes filtroActivo={filtro} naveActiva={nave} conteos={conteos} baseUrl="/cultivos" />
        {lotesFiltrados.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ margin: 0, color: '#6b7280' }}>No hay lotes con este filtro.</p>
            <Link href="/cultivos/nuevo" className="btn" style={{ marginTop: '16px', display: 'inline-block' }}>+ Crear lote</Link>
          </div>
        ) : lotesFiltrados.map((lote) => <LoteCard key={lote.id_lote} lote={lote} movimientos={movimientos} ubicaciones={ubicaciones} variedades={variedades} />)}
      </div>
    </>
  );
}