import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Lote, Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import EditarLoteForm from './EditarLoteForm';
export const dynamic = 'force-dynamic';
export default async function EditarLotePage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const idLote = decodeURIComponent(params.id);
  const [lotes, ubicaciones] = await Promise.all([readSheet<Lote>('Lotes'), readSheet<Ubicacion>('Ubicaciones')]);
  const lote = lotes.find((l) => l.id_lote === idLote);
  if (!lote) notFound();
  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <Link href={'/cultivos/' + encodeURIComponent(idLote)} style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver al detalle del lote</Link>
        <h1 className="page-title">Editar lote <span className="lote-id">Nro Lote: {idLote}</span></h1>
        <p className="page-subtitle">Editá el estado actual del lote manualmente. Usá esto solo para correcciones.</p>
        <div className="alert-box warning" style={{ marginBottom: '14px' }}><strong>Atención:</strong> Esta pantalla modifica el estado del lote directamente sin crear un movimiento. Úsala solo para correcciones.</div>
        <EditarLoteForm lote={lote} ubicaciones={ubicaciones.filter((u) => u.activo === 'SI')} />
      </div>
    </>
  );
}