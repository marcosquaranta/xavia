import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';
import Header from '@/components/Header';
import VentasManager from './VentasManager';
export const dynamic = 'force-dynamic';

export default async function VentasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let clientes: ClienteVenta[] = [], precios: PrecioVenta[] = [], ventas: VentaDia[] = [];
  let err: string | null = null;
  try {
    [clientes, precios, ventas] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'),
      readSheet<PrecioVenta>('Precios'),
      readSheet<VentaDia>('Ventas'),
    ]);
  } catch (e: any) { err = e?.message || 'Error cargando datos'; }

  if (err) return (
    <>
      <Header user={user} current="ventas" />
      <div className="container"><div className="alert-box error">{err}</div></div>
    </>
  );

  const frecuencias: Record<string, number> = {};
  for (const v of ventas) {
    if (v.id_control) frecuencias[v.id_control] = (frecuencias[v.id_control] || 0) + 1;
  }

  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <h1 className="page-title">Ventas</h1>
        <p className="page-subtitle">Carga diaria · Exportación Xubio</p>
        <div className="card">
          <VentasManager
            clientes={clientes.filter(c => c.activo === 'SI')}
            precios={precios}
            frecuencias={frecuencias}
          />
        </div>
      </div>
    </>
  );
}
