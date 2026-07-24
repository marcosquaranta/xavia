import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import Header from '@/components/Header';
import HistorialManager from './HistorialManager';
export const dynamic = 'force-dynamic';

export default async function HistorialVentasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h1 className="page-title">Historial de facturación</h1>
            <p className="page-subtitle">Lo ya facturado (enviado a Xubio) y lo todavía pendiente de facturar</p>
          </div>
          <Link href="/ventas" className="btn secondary" style={{ fontSize: '13px', marginTop: '2px' }}>← Volver a Ventas</Link>
        </div>
        <div className="card">
          <HistorialManager />
        </div>
      </div>
    </>
  );
}
