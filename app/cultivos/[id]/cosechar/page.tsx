// app/cultivos/[id]/cosechar/page.tsx
// Cosecha de un lote.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { codigoCultivo } from '@/lib/lotes';
import type { Lote, Variedad, Usuario } from '@/lib/types';
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

  const [lotes, variedades, usuarios] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Variedad>('Variedades'),
    readSheet<Usuario>('Usuarios'),
  ]);

  const lote = lotes.find((l) => l.id_lote === idLote);
  if (!lote) notFound();
  if (lote.estado !== 'activo') {
    redirect(`/cultivos/${encodeURIComponent(idLote)}`);
  }

  const variedad = variedades.find((v) => v.variedad === lote.variedad);
  if (!variedad) notFound();

  const cultivo = codigoCultivo(lote.variedad);
  // Solo lechuga se cosecha por planta. Rúcula y albahaca por paquete.
  const esPorPaquete = cultivo !== 'L';

  const cosechadores = usuarios.filter((u) => u.activo === 'SI');

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
          Cosechar lote <span className="lote-id">{lote.id_lote}</span>
        </h1>
        <p className="page-subtitle">
          {lote.variedad} · {lote.ubicacion_actual} ·{' '}
          {lote.plantas_estimadas_actual
            ? `~${lote.plantas_estimadas_actual} plantas estimadas`
            : ''}
          {esPorPaquete &&
            ` · esperado: ${variedad.plantas_por_unidad_esperado} plantas/paquete`}
        </p>

        <CosechaForm
          lote={lote}
          variedad={variedad}
          esPorPaquete={esPorPaquete}
          cosechadores={cosechadores.map((u) => ({
            email: u.email,
            nombre: u.nombre,
          }))}
          usuario={user.email}
        />
      </div>
    </>
  );
}
