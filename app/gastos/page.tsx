import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Gasto, Articulo } from '@/lib/types';
import Header from '@/components/Header';
import GastosManager from './GastosManager';

export const dynamic = 'force-dynamic';

export default async function GastosPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let gastos: Gasto[] = [];
  let articulos: Articulo[] = [];
  let err: string | null = null;
  try {
    [gastos, articulos] = await Promise.all([
      readSheet<Gasto>('Gastos'),
      readSheet<Articulo>('Articulos').catch(() => []),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }

  return (
    <>
      <Header user={user} current="gastos" />
      <div className="container">
        <h1 className="page-title">Gastos</h1>
        <p className="page-subtitle">Registro de gastos e insumos · carga y exportación mensual</p>
        {err ? <div className="alert-box error">{err}</div> : <GastosManager gastos={gastos} articulos={articulos.filter((a) => a.activo === 'SI')} usuario={user.email} />}
      </div>
    </>
  );
}
