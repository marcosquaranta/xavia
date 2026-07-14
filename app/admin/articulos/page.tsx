import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Articulo } from '@/lib/types';
import Header from '@/components/Header';
import ArticulosManager from './ArticulosManager';

export const dynamic = 'force-dynamic';

export default async function ArticulosPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  const articulos = await readSheet<Articulo>('Articulos');

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <h1 className="page-title">Artículos de stock</h1>
        <p className="page-subtitle">Categorías, unidades y fórmula de uso teórico por artículo</p>
        <ArticulosManager articulos={articulos} />
      </div>
    </>
  );
}
