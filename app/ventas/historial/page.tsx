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
            {/* Las dos pantallas se confundían porque las dos listaban pendientes. La
                diferencia no es QUÉ muestran sino para qué sirven: una emite, la otra
                corrige lo emitido. Dicho así y con el link, deja de haber dos listas que
                parecen la misma. */}
            <p className="page-subtitle">
              Acá se <strong>corrige</strong> lo ya facturado: cambiar cantidades (sale la nota de crédito o la factura
              por la diferencia) o anular una carga.{' '}
              <Link href="/facturacion" style={{ color: '#2563eb', fontWeight: 600 }}>Facturación</Link> es donde se emiten.
            </p>
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
