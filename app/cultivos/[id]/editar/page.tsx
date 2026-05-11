import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Lote, Ubicacion, Movimiento } from '@/lib/types';
import Header from '@/components/Header';
import EditarLoteForm from './EditarLoteForm';
export const dynamic = 'force-dynamic';

export default async function EditarLotePage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const idLote = decodeURIComponent(params.id);

  const [lotes, ubicaciones, movimientos] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Ubicacion>('Ubicaciones'),
    readSheet<Movimiento>('Movimientos'),
  ]);

  const lote = lotes.find((l) => l.id_lote === idLote);
  if (!lote) notFound();

  // Movimientos de este lote ordenados por fecha
  const movsLote = movimientos
    .filter((m) => m.id_lote === idLote)
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

  const movSiembra   = movsLote.find((m) => m.tipo === 'siembra');
  const movF1        = movsLote.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_1');
  const movF2        = movsLote.find((m) => m.tipo === 'trasplante' && m.fase_destino === 'fase_2');
  const movCosecha   = movsLote.find((m) => m.tipo === 'cosecha');

  // Pasar solo los datos serializables al client component
  const fechas = {
    siembra:  { id: String(movSiembra?.id_movimiento  ?? ''), fecha: String(movSiembra?.fecha  ?? lote.fecha_siembra ?? '') },
    f1:       { id: String(movF1?.id_movimiento       ?? ''), fecha: String(movF1?.fecha       ?? '') },
    f2:       { id: String(movF2?.id_movimiento       ?? ''), fecha: String(movF2?.fecha       ?? '') },
    cosecha:  { id: String(movCosecha?.id_movimiento  ?? ''), fecha: String(movCosecha?.fecha  ?? lote.fecha_cosecha ?? '') },
  };

  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <Link href={'/cultivos/' + encodeURIComponent(idLote)} style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>
          ← Volver al detalle del lote
        </Link>
        <h1 className="page-title">Editar lote <span className="lote-id">Nro Lote: {idLote}</span></h1>
        <p className="page-subtitle">Corrección de fechas y estado. Los cambios se guardan directamente en los registros.</p>
        <div className="alert-box warning" style={{ marginBottom: '14px' }}>
          <strong>Atención:</strong> Usá esta pantalla solo para corregir errores de carga. Las fechas afectan el cálculo de días por fase y las estadísticas.
        </div>
        <EditarLoteForm
          lote={lote}
          ubicaciones={ubicaciones.filter((u) => u.activo === 'SI')}
          fechas={fechas}
        />
      </div>
    </>
  );
}
