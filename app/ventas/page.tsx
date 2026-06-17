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
  const emptyPaq = () => ({ rucula: 0, lechuga_crespa: 0, hoja_roble: 0 });
  const emptyKg  = () => ({ rucula_kg: 0, lechuga_kg: 0 });
  const r = { semanaActual: emptyPaq(), semanaAnterior: emptyPaq(), mesActual: emptyPaq(), mesAnterior: emptyPaq() };
  const kg = { semanaActual: emptyKg(), semanaAnterior: emptyKg(), mesActual: emptyKg(), mesAnterior: emptyKg() };
  for (const v of ventas) {
    const f = safeD(v.fecha); if (!f) continue;
    const keysPaq = ['rucula','lechuga_crespa','hoja_roble'] as const;
    const keysKg  = ['rucula_kg','lechuga_kg'] as const;
    const addPaq = (t: typeof r.semanaActual)  => { for (const k of keysPaq) t[k] += Number((v as any)[k]) || 0; };
    const addKg  = (t: typeof kg.semanaActual) => { for (const k of keysKg)  t[k] += Number((v as any)[k]) || 0; };
    if (f >= ini7)                          { addPaq(r.semanaActual);  addKg(kg.semanaActual); }
    if (f >= ini14 && f < ini7)            { addPaq(r.semanaAnterior); addKg(kg.semanaAnterior); }
    if (f >= iniMes)                        { addPaq(r.mesActual);     addKg(kg.mesActual); }
    if (f >= iniMesAnt && f <= finMesAnt)  { addPaq(r.mesAnterior);   addKg(kg.mesAnterior); }
  }
  return { ...r, kg };
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

  // Ventas de hace 7 días para comparación
  const hoyStr2 = new Date().toISOString().split('T')[0];
  const hace7Str = (() => { const d = new Date(); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; })();
  const ventas7 = ventas.filter(v => v.fecha === hace7Str);
  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <h1 className="page-title">Ventas</h1>
        <p className="page-subtitle">Carga diaria · Exportación Xubio</p>
        <div className="card">
          <VentasManager clientes={clientes.filter(c=>c.activo==='SI')} precios={precios} frecuencias={frecuencias} stats={calcStats(ventas)} ventas7={ventas7} />
        </div>
      </div>
    </>
  );
}
