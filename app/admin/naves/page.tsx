import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import Header from '@/components/Header';
import NavesForm from './NavesForm';
import type { Ubicacion } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AdminNavesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let rows: Ubicacion[] = [];
  let fallo: string | null = null;
  try {
    rows = await readSheet<Ubicacion>('Ubicaciones');
  } catch (e: any) {
    fallo = e?.message || 'no se pudo leer la hoja Ubicaciones';
  }

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <Link href="/admin" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Admin</Link>
        <h1 className="page-title">Naves y mesadas</h1>
        <p className="page-subtitle">
          A qué cultivo y fase está asignada cada mesada, y su capacidad física · {rows.length} ubicaciones
        </p>

        {/* Lo que se cambia acá es la base del plan de siembra: de estas tres columnas salen
            las posiciones de rúcula, de lechuga F1 y de lechuga F2 con las que la calculadora
            decide cuántas planchas sembrar y cuántos perfiles trasplantar por semana. */}
        <div className="alert-box info" style={{ marginBottom: '14px', fontSize: '13px' }}>
          De acá sale la capacidad con la que se calcula todo el plan: planchas a sembrar, perfiles a
          trasplantar y cosecha proyectada por semana. Un cambio acá se ve en Planificación enseguida.
          Los lotes que ya están en una mesada no se mueven solos — si una mesada cambia de cultivo,
          lo que está adentro hay que cosecharlo o descartarlo como siempre.
        </div>

        {fallo
          ? <div className="alert-box error">No se pudo leer la configuración: {fallo}</div>
          : rows.length === 0
            ? <div className="card"><p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Sin datos.</p></div>
            : <NavesForm ubicaciones={rows} />}
      </div>
    </>
  );
}
