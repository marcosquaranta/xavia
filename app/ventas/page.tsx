import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';
import Header from '@/components/Header';
import VentasManager from './VentasManager';
export const dynamic = 'force-dynamic';

function safeD(s: any): Date | null {
  try { const d = new Date(String(s||'').split(/[\sT]/)[0]+'T12:00:00'); return isNaN(d.getTime())?null:d; } catch { return null; }
}

function calcStats(ventas: VentaDia[]) {
  const hoy = new Date();
  const ini7  = new Date(hoy); ini7.setDate(hoy.getDate()-7);
  const ini14 = new Date(hoy); ini14.setDate(hoy.getDate()-14);
  const iniMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iniMesAnt = new Date(hoy.getFullYear(), hoy.getMonth()-1, 1);
  const finMesAnt = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59);
  const empty = () => ({ rucula: 0, lechuga_crespa: 0, hoja_roble: 0 });
  const r = { semanaActual: empty(), semanaAnterior: empty(), mesActual: empty(), mesAnterior: empty() };
  for (const v of ventas) {
    const f = safeD(v.fecha); if (!f) continue;
    const keys = ['rucula','lechuga_crespa','hoja_roble'] as const;
    const add = (t: typeof r.semanaActual) => { for (const k of keys) t[k] += Number((v as any)[k]||0); };
    if (f >= ini7)                              add(r.semanaActual);
    if (f >= ini14 && f < ini7)               add(r.semanaAnterior);
    if (f >= iniMes)                           add(r.mesActual);
    if (f >= iniMesAnt && f <= finMesAnt)     add(r.mesAnterior);
  }
  return r;
}

export default async function VentasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  let clientes: ClienteVenta[] = [], precios: PrecioVenta[] = [], ventas: VentaDia[] = [];
  let err: string | null = null;
  try {
    [clientes, precios, ventas] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'), readSheet<PrecioVenta>('Precios'), readSheet<VentaDia>('Ventas'),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }
  if (err) return (<><Header user={user} current="ventas" /><div className="container"><div className="alert-box error">{err}</div></div></>);
  const frecuencias: Record<string,number> = {};
  for (const v of ventas) frecuencias[v.id_control] = (frecuencias[v.id_control]||0) + 1;
  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <h1 className="page-title">Ventas</h1>
        <p className="page-subtitle">Carga diaria · Exportación Xubio</p>
        <div className="card">
          <VentasManager clientes={clientes.filter(c=>c.activo==='SI')} precios={precios} frecuencias={frecuencias} stats={calcStats(ventas)} />
        </div>
      </div>
    </>
  );
}
