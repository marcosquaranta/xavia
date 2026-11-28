import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { leerVentasConIdsUnicos } from '@/lib/ventasIds';
import type { ClienteVenta, PrecioVenta } from '@/lib/types';
import { clavesDeVenta } from '@/lib/clavesVenta';
import { entregasDelDia, claveEntrega, soloDia } from '@/lib/entregas';
import { leerEntregas } from '@/lib/entregasServer';
import { precioFinal } from '@/lib/estadisticasVentas';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import { LABELS_LARGOS } from '@/lib/articulos';
import Header from '@/components/Header';
import CargadasManager from './CargadasManager';

export const dynamic = 'force-dynamic';

// ══ Ventas cargadas ═══════════════════════════════════════════════════════════════════
//
// Desde que la factura sale cuando el reparto confirma el remito, la pantalla de Ventas
// solo CARGA. Hacía falta un lugar donde ver lo otro: qué se cargó cada día, qué se
// facturó y —lo que importa— si se facturó contra un remito confirmado o sin él.
//
// Las tres situaciones son distintas y antes se veían iguales:
//
//   · Con remito   → alguien dijo qué se entregó y la factura salió con eso.
//   · Sin remito   → se facturó lo que se había cargado porque nadie confirmó. Nadie dijo
//                    que se entregó eso: si estaba mal, hay que corregirlo con una NC.
//   · Esperando    → todavía no se facturó. Se puede forzar desde acá.
const DIAS = 10;

export default async function VentasCargadasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Plata = solo admin, igual que el resto de Ventas.
  if (user.rol !== 'admin') redirect('/panel');

  const hoy = fechaArgentinaHoy();
  const desde = new Date(Date.parse(`${hoy}T12:00:00Z`) - (DIAS - 1) * 86400000).toISOString().slice(0, 10);

  const [ventas, clientes, precios, entregas, claves] = await Promise.all([
    leerVentasConIdsUnicos(),
    readSheet<ClienteVenta>('Clientes'),
    readSheet<PrecioVenta>('Precios'),
    leerEntregas(),
    clavesDeVenta(),
  ]);

  const fechas = Array.from(new Set(
    ventas.map((v) => soloDia(v.fecha)).filter((f) => f >= desde && f <= hoy),
  )).sort((a, b) => b.localeCompare(a));

  const porEntrega = new Map(entregas.map((e) => [claveEntrega(e.fecha, e.id_control, e.sucursal), e]));
  const clientePorId = new Map(clientes.map((c) => [String(c.id_control), c]));

  const dias = fechas.map((f) => {
    const grupos = entregasDelDia(ventas, clientes, entregas, f, claves).map((g) => {
      const e = porEntrega.get(g.clave);
      const c = clientePorId.get(g.id_control);
      const total = g.lineas.reduce((a, l) => a + l.entregado * (Number(precioFinal(precios, g.id_control, g.sucursal, l.key, c)) || 0), 0);
      const cambios = g.lineas.filter((l) => l.entregado !== l.pedido).length;
      return {
        clave: g.clave,
        id_control: g.id_control,
        cliente: g.cliente,
        sucursal: g.sucursal,
        detalle: g.lineas.map((l) => `${l.entregado} ${LABELS_LARGOS[l.key] || l.key}`).join(' · '),
        total: Math.round(total),
        cambios,
        // Las tres situaciones. 'con_remito' pide las dos cosas: comprobante Y alguien que
        // haya dicho qué se entregó.
        estado: g.yaFacturada
          ? (e && e.estado === 'validada' ? 'con_remito' : 'sin_remito')
          : 'esperando',
        comprobante: g.comprobante,
        confirmadoPor: e?.validado_por || '',
        confirmadoEn: e?.validado_en || '',
      };
    });
    return { fecha: f, grupos };
  }).filter((d) => d.grupos.length > 0);

  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <Link href="/ventas" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Ventas</Link>
        <h1 className="page-title">Ventas cargadas</h1>
        <p className="page-subtitle">
          Qué se cargó cada día y qué pasó con eso. La factura sale cuando el reparto confirma la entrega;
          lo que nadie confirma se factura solo a las 16, <strong>con las cantidades que se cargaron</strong>.{' '}
          <Link href="/ventas/historial" style={{ color: '#2563eb', fontWeight: 600 }}>Historial de facturación</Link> es para corregir lo que ya salió.
        </p>
        <CargadasManager dias={dias} />
      </div>
    </>
  );
}
