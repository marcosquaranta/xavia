import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, batchUpdateRows } from '@/lib/sheets';
import { emitirPendientes } from '@/lib/facturacionEmitir';
import { entregasConCobro, avisarCobroEnEntrega } from '@/lib/avisoCobroEntrega';
import type { VentaDia, ClienteVenta } from '@/lib/types';

// A quién le llega el aviso de "hay que cobrar en la entrega".
const DESTINATARIOS_AVISO = ['administracion@xavia.com.ar'];

const QTY_KEYS = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'];

// Marca las ventas borrador de una fecha como PENDIENTE y las emite DIRECTO a Xubio
// (una factura por cliente, sin pasar por la sección Facturación). Las que fallen
// (ej. cliente no encontrado en Xubio) quedan como PENDIENTE para arreglar/reintentar
// desde Facturación; el resto de ajustes se hacen con NC o directo en Xubio.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { fecha } = await req.json();
    if (!fecha) return NextResponse.json({ error: 'fecha requerida' }, { status: 400 });

    const ventas = await readSheet<VentaDia>('Ventas');
    const aCargar = ventas.filter(v =>
      v.fecha === fecha &&
      (!v.exportado || v.exportado === '') &&
      QTY_KEYS.some(k => Number((v as any)[k]) > 0)
    );
    if (!aCargar.length) return NextResponse.json({ error: 'No hay ventas para cargar en esa fecha' }, { status: 400 });

    await batchUpdateRows('Ventas', 'id_venta', aCargar.map(v => ({
      keyValue: v.id_venta,
      updates: { exportado: 'PENDIENTE' },
    })));

    // readSheet convierte columnas "numéricas" (como id_control) de string a number
    // automáticamente. emitirPendientes compara contra String(v.id_control), así que
    // acá hay que forzar string también — si no, el Set nunca matchea y la emisión
    // queda vacía en silencio (sin error, sin factura).
    const idControls = Array.from(new Set(aCargar.map(v => String(v.id_control))));
    let emitidas: { cliente: string; numero?: string; cae?: string }[] = [];
    let errores: { cliente: string; error: string }[] = [];
    try {
      const r = await emitirPendientes(idControls);
      emitidas = r.emitidas; errores = r.errores;
      if (errores.length) console.error('[ventas/cargar] errores al emitir a Xubio:', JSON.stringify(errores));
      // El aviso de CAEs pendientes ya NO sale acá: un día con tres cargas mandaba tres
      // mails. Las emisiones quedan registradas (ver lib/caePendientes.ts) y sale un solo
      // aviso acumulado por la mañana, desde /api/cron/cae-pendientes.
    } catch (e: any) {
      console.error('[ventas/cargar] excepción al emitir a Xubio:', e);
      errores = [{ cliente: 'Xubio', error: e?.message || 'Error al emitir' }];
    }

    // El mail de "Facturación pendiente" se sacó a pedido: el único aviso que queda es el
    // de CAEs pendientes, que ahora sale una vez por día. Los errores de emisión se
    // muestran igual en pantalla al terminar la carga, con el detalle por cliente.
    const clientes = idControls.length;
    // Aviso de cobro contra entrega. Va después de emitir y dentro de su propio try: que
    // falle un mail no puede tirar abajo una carga de ventas que ya se hizo.
    let avisoCobro: { sucursal: string }[] = [];
    try {
      const clientesRows = await readSheet<ClienteVenta>('Clientes');
      const entregas = entregasConCobro(aCargar, clientesRows, fecha);
      if (entregas.length) {
        await avisarCobroEnEntrega(entregas, DESTINATARIOS_AVISO);
        avisoCobro = entregas.map(e => ({ sucursal: e.sucursal }));
      }
    } catch (e) {
      console.error('[ventas/cargar] no se pudo mandar el aviso de cobro en entrega:', e);
    }

    return NextResponse.json({ ok: true, lineas: aCargar.length, clientes, emitidas, errores, avisoCobro });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
