import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';
import { nombreClienteVisible } from '@/lib/clientes';
import Header from '@/components/Header';
import FacturacionManager from './FacturacionManager';
import { leerComprobantesCache } from '@/lib/xubioCache';
import { desajustesDeLetra, letrasPorPuntoDeVenta } from '@/lib/controlLetra';

import { ARTICULOS } from '@/lib/articulos';
export const dynamic = 'force-dynamic';

// Todos, incluidos los de baja y el legacy: se factura lo que se cargó, no lo que se
// vende hoy.
const PRODS: { key: string; label: string }[] = [
  ...ARTICULOS.map((a) => ({ key: a.key, label: a.label })),
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
  let emitidos: any[] = [];
  let err: string | null = null;
  const hoyISO = new Date().toISOString().slice(0, 10);
  const desde120 = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  try {
    [clientes, precios, ventas, emitidos] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'), readSheet<PrecioVenta>('Precios'), readSheet<VentaDia>('Ventas'),
      // De la copia local, no de Xubio: acá solo se está revisando la letra de comprobantes
      // que ya existen, y no vale la pena hacer esperar la pantalla por eso.
      leerComprobantesCache(desde120, hoyISO).catch(() => [] as any[]),
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
    // Comparación por texto: readSheet convierte los valores numéricos, así que
    // id_control llega como número desde la hoja y como string desde la clave del
    // grupo. Sin esto no encuentra al cliente y la factura sale sin nombre ni letra.
    const cliente = clientes.find(c => String(c.id_control) === String(idControl));
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

  const desajustes = desajustesDeLetra(emitidos, clientes);
  const porPV = letrasPorPuntoDeVenta(emitidos);

  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <Link href="/ventas" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Ventas</Link>
        <h1 className="page-title">Facturación</h1>
        <p className="page-subtitle">Ventas cargadas pendientes de facturar en Xubio</p>

        {/* La letra del comprobante no la decide la app — ver lib/controlLetra.ts. Esto
            muestra los últimos 120 días de comprobantes que salieron con una letra distinta
            a la configurada, para no tener que descubrirlo cliente por cliente. */}
        {desajustes.length > 0 && (
          <div className="card" style={{ marginBottom: '14px', borderLeft: '4px solid #dc2626' }}>
            <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 800, color: '#991b1b' }}>
              {desajustes.length === 1
                ? 'Hay una factura que salió con otra letra'
                : `Hay ${desajustes.length} facturas que salieron con otra letra`}
              <span style={{ fontWeight: 400, color: '#6b7280' }}> · últimos 120 días</span>
            </p>
            <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280' }}>
              La app elige el punto de venta; la letra final la resuelve Xubio con la condición de IVA que tiene
              cargada de ese cliente. Si no coinciden, hay que corregir en Xubio (la condición del cliente) o acá
              (el tipo de factura). Lo ya emitido no se cambia desde la app.
            </p>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' }}>
              <thead><tr style={{ background: '#fafaf9', color: '#6b7280' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left' }}>Cliente</th>
                <th style={{ padding: '4px 8px', textAlign: 'left' }}>Comprobante</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Fecha</th>
                <th style={{ padding: '4px 8px', textAlign: 'center' }}>Salió</th>
                <th style={{ padding: '4px 8px', textAlign: 'center' }}>Esperaba</th>
              </tr></thead>
              <tbody>
                {desajustes.slice(0, 40).map((d) => (
                  <tr key={d.numero}>
                    <td style={{ padding: '4px 8px', borderTop: '1px solid #f3f4f6' }}>{d.cliente}</td>
                    <td style={{ padding: '4px 8px', borderTop: '1px solid #f3f4f6', fontFamily: 'monospace', fontSize: '11.5px' }}>{d.numero}</td>
                    <td style={{ padding: '4px 8px', borderTop: '1px solid #f3f4f6', textAlign: 'right', color: '#6b7280' }}>{d.fecha}</td>
                    <td style={{ padding: '4px 8px', borderTop: '1px solid #f3f4f6', textAlign: 'center', fontWeight: 800, color: '#dc2626' }}>{d.emitida}</td>
                    <td style={{ padding: '4px 8px', borderTop: '1px solid #f3f4f6', textAlign: 'center', fontWeight: 700, color: '#6b7280' }}>{d.esperada}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {desajustes.length > 40 && (
              <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#9ca3af' }}>… y {desajustes.length - 40} más.</p>
            )}
            {/* Esto separa "tres clientes mal cargados" de "el punto de venta está mal":
                si el PV que usamos para las B emitió cien B y tres A, el problema son esos
                tres clientes; si emitió todas A, el que está mal es el PV. */}
            <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#6b7280' }}>
              Qué viene emitiendo cada punto de venta:{' '}
              {porPV.map((p) => `PV ${p.pv} → ${p.letras.map((l) => `${l.n} ${l.letra}`).join(' y ')}`).join(' · ')}
            </p>
          </div>
        )}
        <div className="card">
          <FacturacionManager facturas={facturas} />
        </div>
      </div>
    </>
  );
}
