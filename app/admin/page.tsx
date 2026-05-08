// app/admin/semillas/page.tsx
// Catálogo de semillas (CRUD).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Semilla, Variedad } from '@/lib/types';
import Header from '@/components/Header';
import SemillasManager from './SemillasManager';

export const dynamic = 'force-dynamic';

export default async function AdminSemillasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const [semillas, variedades] = await Promise.all([
    readSheet<Semilla>('Semillas'),
    readSheet<Variedad>('Variedades'),
  ]);

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

        <h1 className="page-title">Semillas</h1>
        <p className="page-subtitle">
          Catálogo de batches de semilla. Se eligen al sembrar un lote para luego
          poder cruzar rendimiento por proveedor.
        </p>

        <SemillasManager
          semillas={semillas}
          variedades={variedades.filter((v) => v.activo === 'SI')}
        />
      </div>
    </>
  );
}
