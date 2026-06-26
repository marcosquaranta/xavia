import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';
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
  { key: 'lechuga_kg', label: 'Lechuga KG' },
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
  lineas: { producto: string; sucursal: string; cantidad: number; precio: number; importe: number }[];
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

  if (err) return (<><Header user={user} current="facturacion" /><div className="container"><div className="alert-box error">{err}</div></div></>);

  const pendientes = ventas.filter(v => v.exportado === 'PENDIENTE');
  const porControl = new Map<string, VentaDia[]>();
  for (const v of pendientes) { const a = porControl.get(v.id_control) || []; a.push(v); porControl.set(v.id_control, a); }

  const facturas: FacturaPendiente[] = [];
  for (const [idControl, lineasV] of porControl) {
    const cliente = clientes.find(c => c.id_control === idControl);
    const lineas: FacturaPendiente['lineas'] = [];
    for (const l of lineasV) {
      for (const p of PRODS) {
        const qty = Number((l as any)[p.key]) || 0;
        if (qty <= 0) continue;
        const precio = getPrecio(precios, idControl, l.sucursal, p.key, cliente?.sucursales);
        lineas.push({ producto: p.label, sucursal: l.sucursal, cantidad: qty, precio, importe: qty * precio });
      }
    }
    if (!lineas.length) continue;
    facturas.push({
      id_control: idControl,
      cliente: cliente?.nombre_display || cliente?.nombre_xubio || idControl,
      letra: cliente?.tipo_factura || '?',
      fecha: lineasV[0].fecha,
      lineas,
      unidades: lineas.reduce((a, l) => a + l.cantidad, 0),
      total: lineas.reduce((a, l) => a + l.importe, 0),
    });
  }
  facturas.sort((a, b) => a.cliente.localeCompare(b.cliente));

  return (
    <>
      <Header user={user} current="facturacion" />
      <div className="container">
        <h1 className="page-title">Facturación</h1>
        <p className="page-subtitle">Ventas cargadas pendientes de facturar en Xubio</p>
        <div className="card">
          <FacturacionManager facturas={facturas} />
        </div>
      </div>
    </>
  );
}
