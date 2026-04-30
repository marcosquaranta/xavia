// app/cultivos/[id]/trasplantar/page.tsx
// Trasplante de un lote: de plantinera a F1/F2 o de F1 a F2.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Lote, Ubicacion, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import TrasplanteForm from './TrasplanteForm';

export const dynamic = 'force-dynamic';

export default async function TrasplantarPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const idLote = decodeURIComponent(params.id);

  const [lotes, ubicaciones, variedades] = await Promise.all([
    readSheet<Lote>('Lotes'),
    readSheet<Ubicacion>('Ubicaciones'),
    readSheet<Variedad>('Variedades'),
  ]);

  const lote = lotes.find((l) => l.id_lote === idLote);
  if (!lote) notFound();

  if (lote.estado !== 'activo' || lote.fase_actual === 'fase_2') {
    // Ya en F2 o cosechado: no se puede trasplantar más
    redirect(`/cultivos/${encodeURIComponent(idLote)}`);
  }

  const variedad = variedades.find((v) => v.variedad === lote.variedad);
  if (!variedad) notFound();

  const fasesAplicables = variedad.fases_aplicables.split(',').map((f) => f.trim());
  const saltaF1 = !fasesAplicables.includes('fase_1');
  // Próxima fase:
  // - Si está en plantín y la variedad salta F1 → va a F2
  // - Si está en plantín y la variedad tiene F1 → va a F1
  // - Si está en F1 → va a F2
  const faseDestino: 'fase_1' | 'fase_2' =
    lote.fase_actual === 'plantin' && !saltaF1 ? 'fase_1' : 'fase_2';

  // Ubicaciones destino disponibles (mismo cultivo + sector_fase = faseDestino)
  const variedadEsRucula =
    lote.variedad.toLowerCase().includes('rucula') ||
    lote.variedad.toLowerCase().includes('rúcula');
  const variedadEsAlbahaca = lote.variedad.toLowerCase().includes('albahaca');
  const variedadAsignada = variedadEsRucula
    ? 'rucula'
    : variedadEsAlbahaca
    ? 'rucula'
    : 'lechuga';

  const ubicacionesDestino = ubicaciones.filter(
    (u) =>
      u.activo === 'SI' &&
      u.tipo === 'mesada' &&
      u.sector_fase === faseDestino &&
      (u.variedad_asignada === variedadAsignada || u.variedad_asignada === 'mixta')
  );

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
          Trasplantar lote <span className="lote-id">{lote.id_lote}</span>
        </h1>
        <p className="page-subtitle">
          {lote.variedad} · {lote.ubicacion_actual} · pasa a{' '}
          {faseDestino === 'fase_1' ? 'Fase 1' : 'Fase 2'}
        </p>

        <TrasplanteForm
          lote={lote}
          faseDestino={faseDestino}
          ubicacionesDestino={ubicacionesDestino}
          variedadEsRucula={variedadEsRucula}
          usuario={user.email}
        />
      </div>
    </>
  );
}
