// app/admin/naves/page.tsx
// Configuración de capacidades de naves. Solo admin.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Ubicacion } from '@/lib/types';
import Header from '@/components/Header';
import NavesForm from './NavesForm';

export const dynamic = 'force-dynamic';

export default async function AdminNavesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const ubicaciones = await readSheet<Ubicacion>('Ubicaciones');
  const ubicacionesActivas = ubicaciones
    .filter((u) => u.activo === 'SI')
    .sort((a, b) => Number(a.orden_visual) - Number(b.orden_visual));

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <Link
          href="/admin"
          style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}
        >
          ← Volver a Admin
        </Link>

        <h1 className="page-title">Configuración de naves</h1>
        <p className="page-subtitle">
          Editá tubos, perfiles y orificios por mesada. La capacidad se calcula automáticamente.
        </p>

        <NavesForm ubicaciones={ubicacionesActivas} />
      </div>
    </>
  );
}
