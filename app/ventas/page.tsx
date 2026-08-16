import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia, VentaHistorica, PedidoFijo } from '@/lib/types';
import { evolucionVentaPorArticulo, evolucionVentaPorCliente, evolucionVentaPorClienteSemanal, evolucionPrecioPromedio, resumenMesActual } from '@/lib/estadisticasVentas';
import Header from '@/components/Header';
import VentasManager from './VentasManager';
import XubioResumen from './XubioResumen';
import VentasEvolucionCharts from './VentasEvolucionCharts';
export const dynamic = 'force-dynamic';

function safeD(s: any): Date | null {
  try { const d = new Date(String(s||'').split(/[\sT]/)[0]+'T12:00:00'); return isNaN(d.getTime())?null:d; } catch { return null; }
}

function startOfWeek(d: Date): Date {
  // Lunes de la semana actual
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay(); // 0=dom, 1=lun
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}

function calcStats(ventas: VentaDia[]) {
  const hoy = new Date();
  // Semana calendario: lunes actual y lunes anterior
  const iniSemAct  = startOfWeek(hoy);
  const iniSemAnt  = new Date(iniSemAct); iniSemAnt.setDate(iniSemAct.getDate() - 7);
  const finSemAnt  = new Date(iniSemAct); finSemAnt.setTime(finSemAnt.getTime() - 1);
  const iniMes     = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iniMesAnt  = new Date(hoy.getFullYear(), hoy.getMonth()-1, 1);
  const finMesAnt  = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59);
  const emptyPaq = () => ({ rucula: 0, lechuga_crespa: 0, hoja_roble: 0 });
  // lechuga_kg (legacy) queda para no perder ventas cargadas antes del split crespa/roble.
  const emptyKg  = () => ({ rucula_kg: 0, lechuga_kg: 0, lechuga_kg_crespa: 0, lechuga_kg_roble: 0 });
  const r = { semanaActual: emptyPaq(), semanaAnterior: emptyPaq(), mesActual: emptyPaq(), mesAnterior: emptyPaq() };
  const kg = { semanaActual: emptyKg(), semanaAnterior: emptyKg(), mesActual: emptyKg(), mesAnterior: emptyKg() };
  for (const v of ventas) {
    const f = safeD(v.fecha); if (!f) continue;
    const keysPaq = ['rucula','lechuga_crespa','hoja_roble'] as const;
    const keysKg  = ['rucula_kg','lechuga_kg','lechuga_kg_crespa','lechuga_kg_roble'] as const;
    const addPaq = (t: typeof r.semanaActual)  => { for (const k of keysPaq) t[k] += Number((v as any)[k]) || 0; };
    const addKg  = (t: typeof kg.semanaActual) => { for (const k of keysKg)  t[k] += Number((v as any)[k]) || 0; };
    if (f >= iniSemAct)                         { addPaq(r.semanaActual);  addKg(kg.semanaActual); }
    if (f >= iniSemAnt && f < iniSemAct)        { addPaq(r.semanaAnterior); addKg(kg.semanaAnterior); }
    if (f >= iniMes)                             { addPaq(r.mesActual);     addKg(kg.mesActual); }
    if (f >= iniMesAnt && f <= finMesAnt)        { addPaq(r.mesAnterior);   addKg(kg.mesAnterior); }
  }
  return { ...r, kg };
}

export default async function VentasPage({ searchParams }: { searchParams: { fecha?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');
  let clientes: ClienteVenta[] = [], precios: PrecioVenta[] = [], ventas: VentaDia[] = [];
  let historicas: VentaHistorica[] = [];
  let pedidosFijos: PedidoFijo[] = [];
  let err: string | null = null;
  try {
    [clientes, precios, ventas, historicas, pedidosFijos] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'), readSheet<PrecioVenta>('Precios'), readSheet<VentaDia>('Ventas'),
      readSheet<VentaHistorica>('VentasHistoricas').catch(() => []),
      readSheet<PedidoFijo>('PedidosFijos').catch(() => []),
    ]);
  } catch (e: any) { err = e?.message || 'Error'; }
  if (err) return (<><Header user={user} current="ventas" /><div className="container"><div className="alert-box error">{err}</div></div></>);
  const frecuencias: Record<string,number> = {};
  for (const v of ventas) frecuencias[v.id_control] = (frecuencias[v.id_control]||0) + 1;

  const evolArticulo = evolucionVentaPorArticulo(ventas, 12, historicas);
  const evolClienteSemanal = evolucionVentaPorClienteSemanal(ventas, clientes, 6, 5);
  const evolClienteMensual = evolucionVentaPorCliente(ventas, clientes, 6, 5);
  const evolPrecio = evolucionPrecioPromedio(ventas, precios, clientes, 12);
  const resumenMes = resumenMesActual(ventas, precios, clientes);

  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h1 className="page-title">Ventas</h1>
            <p className="page-subtitle">Carga diaria · Exportación Xubio</p>
          </div>
          <Link href="/facturacion" className="btn secondary" style={{ fontSize: '13px', marginTop: '2px' }}>
            📄 Facturación →
          </Link>
        </div>
        <VentasEvolucionCharts articulo={evolArticulo} clienteSemanal={evolClienteSemanal} clienteMensual={evolClienteMensual} precio={evolPrecio} resumenMes={resumenMes} />
        <div className="card">
          <VentasManager clientes={clientes.filter(c=>c.activo==='SI')} precios={precios} frecuencias={frecuencias} stats={calcStats(ventas)} pedidosFijos={pedidosFijos.filter(p=>p.activo==='SI')} initialFecha={searchParams.fecha} />
          <XubioResumen />
        </div>
      </div>
    </>
  );
}
