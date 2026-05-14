import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Lote, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import TrasplanteForm from './TrasplanteForm';
export const dynamic = 'force-dynamic';
export default async function TrasplantarPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const idLote = decodeURIComponent(params.id);
  const [lotes, ubicaciones, variedades] = await Promise.all([readSheet<Lote>('Lotes'), readSheet<Ubicacion>('Ubicaciones'), readSheet<Variedad>('Variedades')]);
  const lote = lotes.find((l) => l.id_lote === idLote);
  if (!lote) notFound();
  if (lote.estado !== 'activo' || lote.fase_actual === 'fase_2') redirect('/cultivos/' + encodeURIComponent(idLote));
  const variedad = variedades.find((v) => v.variedad === lote.variedad);
  if (!variedad) notFound();
  const saltaF1 = !variedad.fases_aplicables.split(',').map((f) => f.trim()).includes('fase_1');
  const faseDestino: 'fase_1' | 'fase_2' = lote.fase_actual === 'plantin' && !saltaF1 ? 'fase_1' : 'fase_2';
  const v = lote.variedad.toLowerCase();
  const variedadAsignada = (v.includes('rucula') || v.includes('rúcula') || v.includes('albahaca')) ? 'rucula' : 'lechuga';
  const destinos = ubicaciones.filter((u) => u.activo === 'SI' && u.tipo === 'mesada' && u.sector_fase === faseDestino && (u.variedad_asignada === variedadAsignada || u.variedad_asignada === 'mixta'));
  const esRucula = variedadAsignada === 'rucula';
  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <Link href="/cultivos" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Mis cultivos</Link>
        <h1 className="page-title">Trasplantar lote <span className="lote-id">Nro Lote: {lote.id_lote}</span></h1>
        <p className="page-subtitle">{lote.variedad} · {lote.ubicacion_actual} · pasa a {faseDestino === 'fase_1' ? 'Fase 1' : 'Fase 2'}</p>
        <TrasplanteForm lote={lote} faseDestino={faseDestino} ubicacionesDestino={destinos} usuario={user.email} esRucula={esRucula} />
      </div>
    </>
  );
}