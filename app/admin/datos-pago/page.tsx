import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import Header from '@/components/Header';
import { DatosPago } from '@/components/CobranzasConfig';
import { CONFIG_DATOS_PAGO, DATOS_PAGO_DEFAULT } from '@/lib/recordatoriosCobro';

export const dynamic = 'force-dynamic';

// Los datos bancarios que van al pie de cada recordatorio de cobranza.
//
// Viven en Admin y no en Cobranzas: se editan una vez por año —cuando cambia una cuenta— y
// en Cobranzas ocupaban un lugar que compite con el trabajo del día, que es imputar cobros.
export default async function DatosPagoPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let configRows: { clave: string; valor: any }[] = [];
  try {
    configRows = await readSheet<{ clave: string; valor: any }>('Configuracion');
  } catch { /* la hoja puede no existir todavía: se usa el default */ }

  const fila = configRows.find((r) => String(r.clave).trim() === CONFIG_DATOS_PAGO);
  const datosPago = String(fila?.valor || '').trim() || DATOS_PAGO_DEFAULT;

  return (
    <>
      <Header user={user} current="admin" />
      <div className="container">
        <Link href="/admin" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Admin</Link>
        <h1 className="page-title">Datos de pago</h1>
        <p className="page-subtitle">
          Lo que va al pie de cada recordatorio de cobranza que se le manda a un cliente, para que sepa
          dónde transferir. Se usa tal cual está escrito acá.
        </p>
        <div className="card">
          <DatosPago valor={datosPago} />
        </div>
      </div>
    </>
  );
}
