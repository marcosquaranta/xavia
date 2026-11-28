import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { leerVentasConIdsUnicos } from '@/lib/ventasIds';
import type { ClienteVenta, CajonMovimiento } from '@/lib/types';
import { clavesDeVenta } from '@/lib/clavesVenta';
import { entregasDelDia } from '@/lib/entregas';
import { leerEntregas } from '@/lib/entregasServer';
import { saldoPorCliente } from '@/lib/cajones';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import { LABELS_LARGOS } from '@/lib/articulos';
import { leerArticulosExtra } from '@/lib/articulosVenta';

export const dynamic = 'force-dynamic';

// Las entregas del día para la pantalla del reparto.
//
// Una sola lectura para todo: la lista, los cajones que ese cliente tiene afuera y las
// etiquetas de los artículos. En la calle, cada ida y vuelta de más es una pantalla que
// tarda en abrir con mala señal.
// ── Quién puede entrar ───────────────────────────────────────────────
//
// Cualquiera que tenga usuario. Decisión de Marcos (28-nov-2026): los repartidores ya
// tenían cuenta y arrancar cambiándole el rol a cada uno frenaba el lanzamiento por un
// trámite.
//
// Lo que eso implica, dicho para que no se pierda: confirmar una entrega EMITE UNA FACTURA
// en AFIP, así que esto es lo único que un rol `usuario` puede hacer que mueve plata. El
// resto de la plata sigue siendo solo de admin. El día que se quiera cerrar, se vuelve a
// pedir el rol `reparto` acá y en los dos endpoints, y nada más cambia.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const fecha = String(new URL(req.url).searchParams.get('fecha') || '').trim() || fechaArgentinaHoy();
    const [ventas, clientes, entregas, claves, movCajones, extras] = await Promise.all([
      leerVentasConIdsUnicos(),
      readSheet<ClienteVenta>('Clientes'),
      leerEntregas(),
      clavesDeVenta(),
      readSheet<CajonMovimiento>('CajonesMovimientos').catch(() => [] as CajonMovimiento[]),
      leerArticulosExtra().catch(() => [] as any[]),
    ]);

    const lista = entregasDelDia(ventas, clientes, entregas, fecha, claves);

    // Cuántos cajones tiene afuera cada cliente, para poder decirlo al pedirle los que
    // devuelve. Mismo cálculo que la pantalla de Cajones: importado, no recalculado.
    const saldos = new Map(
      saldoPorCliente(movCajones, clientes, new Date()).map((s) => [String(s.id_control), s.saldo]),
    );

    // Las etiquetas salen del catálogo, no de una lista escrita acá: un artículo dado de
    // alta en Admin tiene que aparecer con su nombre sin que nadie toque este archivo.
    const etiquetas: Record<string, string> = { ...LABELS_LARGOS };
    for (const a of extras) if (a?.key) etiquetas[a.key] = a.label || a.key;

    return NextResponse.json({
      fecha,
      entregas: lista.map((e) => ({ ...e, cajonesAfuera: saldos.get(e.id_control) || 0 })),
      etiquetas,
    });
  } catch (err: any) {
    console.error('[api/reparto/dia]', err);
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
