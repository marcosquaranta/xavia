import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { claveComprobante } from '@/lib/comprobantes';
import type { VentaDia } from '@/lib/types';

export const dynamic = 'force-dynamic';

// ── De un número de factura a la venta que la originó ────────────────────────────────
//
// Existe para poder llegar a la corrección de una factura desde donde se la está mirando —
// la lista de facturas de Cobranzas— en vez de tener que ir al historial y buscarla.
//
// El editor de facturas no se abre por número: se abre por (id_exportacion, id_control),
// que es como están organizadas las ventas. Esta traducción es la que faltaba, y va en el
// servidor porque la hoja de Ventas no está del lado del navegador.
//
// Por qué devuelve el motivo cuando no encuentra nada, en vez de un 404 pelado: una factura
// puede no tener venta detrás por razones muy distintas —se cargó a mano en Xubio, es de
// antes de que la app facturara— y cada una se resuelve distinto. "No se encontró" manda a
// buscar un problema que a veces no existe.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  const numero = String(new URL(req.url).searchParams.get('numero') || '').trim();
  if (!numero) return NextResponse.json({ error: 'Falta el número de factura.' }, { status: 400 });

  try {
    const clave = claveComprobante(numero);
    const ventas = await readSheet<VentaDia>('Ventas');
    // Todas las filas de esa factura. Una factura casi siempre son varias filas —una por
    // sucursal— y todas comparten id_exportacion: por eso se agrupa y no se toma la primera.
    const filas = ventas.filter((v) => claveComprobante((v as any).exportado) === clave);

    if (!filas.length) {
      return NextResponse.json({
        encontrada: false,
        motivo: 'Esa factura no tiene ninguna venta cargada en la app. Puede haberse cargado directo en Xubio, '
          + 'o ser anterior a que la app facturara. Se puede corregir el importe que la app reclama, pero no hay '
          + 'cantidades que editar.',
      });
    }

    const idExportacion = String((filas[0] as any).id_exportacion || '').trim();
    const idControl = String(filas[0].id_control || '').trim();
    if (!idExportacion) {
      return NextResponse.json({
        encontrada: false,
        motivo: 'La venta de esa factura está cargada pero sin id de exportación, así que el editor no la puede abrir. '
          + 'Hay que buscarla en el historial por fecha y cliente.',
      });
    }

    // Más de un cliente en la misma factura no debería pasar nunca y, si pasa, abrir el
    // editor de uno solo mostraría media factura sin decir que falta la otra mitad.
    const clientes = new Set(filas.map((f) => String(f.id_control || '').trim()));
    if (clientes.size > 1) {
      return NextResponse.json({
        encontrada: false,
        motivo: `Esa factura tiene ventas de ${clientes.size} clientes distintos cargadas, lo que no debería pasar. `
          + 'Hay que mirarla en el historial antes de corregir nada.',
      });
    }

    return NextResponse.json({
      encontrada: true,
      numero,
      id_exportacion: idExportacion,
      id_control: idControl,
      cliente: String(filas[0].nombre_cliente || ''),
      fecha: String(filas[0].fecha || '').split(/[T ]/)[0],
      filas: filas.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
