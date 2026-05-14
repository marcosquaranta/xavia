import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Variedad, Semilla } from '@/lib/types';
import Header from '@/components/Header';
import NuevoLoteForm from './NuevoLoteForm';
export const dynamic = 'force-dynamic';
export default async function NuevoLotePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const [variedades, semillas] = await Promise.all([readSheet<Variedad>('Variedades'), readSheet<Semilla>('Semillas')]);
  return (
    <>
      <Header user={user} current="cultivos" />
      <div className="container">
        <Link href="/cultivos" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Mis cultivos</Link>
        <h1 className="page-title">Nuevo lote</h1>
        <p className="page-subtitle">El ID se genera automáticamente al sembrar y se completa al trasplantar.</p>
        <NuevoLoteForm variedades={variedades.filter((v) => v.activo === 'SI')} semillas={semillas.filter((s) => s.activo === 'SI')} usuario={user.email} />
      </div>
    </>
  );
}