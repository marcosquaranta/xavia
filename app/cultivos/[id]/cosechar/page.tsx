// app/cultivos/[id]/cosechar/page.tsx
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { codigoCultivo } from '@/lib/lotes';
import type { Lote, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import CosechaForm from './CosechaForm';

export const dynamic = 'force-dynamic';

export default async function CosecharPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const idLote = decodeURIComponent(params.id);

  const [lotes, variedades] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Variedad>('Variedades'),
  ]);

  const lote = lotes.find((l) => l.id_lote === idLote);
  if (!lote) notFound();
  if (lote.estado !== 'activo') {
    redirect(`/cultivos/${encodeURIComponent(idLote)}`);
  }

  const variedad = variedades.find((v) => v.variedad === lote.variedad);
  if (!variedad) notFound();

  const cultivo = codigoCultivo(lote.variedad);
  const esPorPaquete = cultivo !== 'L';
  const plantasEstimadas =
    Number(lote.plantas_estimadas_actual) || Number(lote.plantines_iniciales) || 0;

  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <Link
          href="/cultivos"
          style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}
        >
          ← Volver a Mis cultivos
        </Link>

        <h1 className="page-title">
          Cosechar <span className="lote-id">Nro Lote: {lote.id_lote}</span>
        </h1>
        <p className="page-subtitle">
          {lote.variedad} · {lote.ubicacion_actual} ·{' '}
          {plantasEstimadas > 0 ? `~${plantasEstimadas} plantas estimadas` : ''}
        </p>

        <CosechaForm
          lote={lote}
          variedad={variedad}
          esPorPaquete={esPorPaquete}
          usuario={user.email}
        />
      </div>
    </>
  );
}
