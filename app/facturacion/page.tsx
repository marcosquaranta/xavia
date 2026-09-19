import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';
import { nombreClienteVisible } from '@/lib/clientes';
import Header from '@/components/Header';
import FacturacionManager from './FacturacionManager';

export const dynamic = 'force-dynamic';

const PRODS: { key: string; label: string }[] = [
  { key: 'rucula', label: 'Rúcula' },
  { key: 'lechuga_crespa', label: 'Crespa' },
  { key: 'hoja_roble', label: 'Roble' },
  { key: 'bandeja_rucula', label: 'Bandeja' },
  { key: 'albahaca', label: 'Albahaca' },
  { key: 'rucula_kg', label: 'Rúcula KG' },
  { key: 'lechuga_kg', label: 'Lechuga KG' }, // legacy, ventas cargadas antes del split crespa/roble
  { key: 'lechuga_kg_crespa', label: 'Lechuga Crespa KG' },
  { key: 'lechuga_kg_roble', label: 'Lechuga Roble KG' },
];

function getPrecio(precios: PrecioVenta[], id_control: string, sucursal: string, key: string, clienteSucursales?: string): number {
  let row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal);
  if (!row && clienteSucursales) {
    for (const s of clienteSucursales.split('|').map(s => s.trim()).filter(Boolean)) {
      row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === s);
      if (row) break;
    }
  }
  if (!row) row = precios.find(p => String(p.id_control) === String(id_control));
  if (!row) return 0;
  return Number((row as any)[key] || 0);
}

export interface FacturaPendiente {
  id_control: string;
  cliente: string;
  letra: string;
  fecha: string;
  // id_venta + campo identifican la celda exacta de la hoja Ventas, que es lo que hace
  // falta para poder corregir o borrar un renglon antes de facturarlo.
  lineas: { id_venta: string; campo: string; producto: string; sucursal: string; cantidad: number; precio: number; importe: number }[];
  unidades: number;
  total: number;
}

export default async function FacturacionPage() {
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

  // Se agrupa por cliente Y FECHA, que es el grano más fino que se puede facturar. La
  // pantalla junta las fechas de un mismo cliente cuando se factura todo junto; al revés
  // (mandar todo junto y querer separarlo en el navegador) no se podría.
  const pendientes = ventas.filter(v => v.exportado === 'PENDIENTE');
  const porControl = new Map<string, VentaDia[]>();
  for (const v of pendientes) {
    const key = `${v.id_control}||${String(v.fecha || '').split(/[T ]/)[0]}`;
    const a = porControl.get(key) || []; a.push(v); porControl.set(key, a);
  }

  const facturas: FacturaPendiente[] = [];
  for (const [key, lineasV] of porControl) {
    const idControl = key.split('||')[0];
    const cliente = clientes.find(c => c.id_control === idControl);
    const lineas: FacturaPendiente['lineas'] = [];
    for (const l of lineasV) {
      for (const p of PRODS) {
        const qty = Number((l as any)[p.key]) || 0;
        if (qty <= 0) continue;
        const precio = getPrecio(precios, idControl, l.sucursal, p.key, cliente?.sucursales);
        lineas.push({ id_venta: String(l.id_venta), campo: p.key, producto: p.label, sucursal: l.sucursal, cantidad: qty, precio, importe: qty * precio });
      }
    }
    if (!lineas.length) continue;
    facturas.push({
      id_control: idControl,
      cliente: nombreClienteVisible(cliente) || idControl,
      letra: cliente?.tipo_factura || '?',
      fecha: String(lineasV[0].fecha || '').split(/[T ]/)[0],
      lineas,
      unidades: lineas.reduce((a, l) => a + l.cantidad, 0),
      total: lineas.reduce((a, l) => a + l.importe, 0),
    });
  }
  facturas.sort((a, b) => a.cliente.localeCompare(b.cliente) || a.fecha.localeCompare(b.fecha));

  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <Link href="/ventas" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Ventas</Link>
        <h1 className="page-title">Facturación</h1>
        <p className="page-subtitle">Ventas cargadas pendientes de facturar en Xubio</p>
        <div className="card">
          <FacturacionManager facturas={facturas} />
        </div>
      </div>
    </>
  );
}
