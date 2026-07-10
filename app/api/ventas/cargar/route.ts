import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, batchUpdateRows } from '@/lib/sheets';
import { enviarResumenPendientes } from '@/lib/resumenFacturacion';
import { emitirPendientes, enviarAvisoCaePendiente } from '@/lib/facturacionEmitir';
import type { VentaDia } from '@/lib/types';

const QTY_KEYS = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg'];

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
      if (emitidas.length) {
        try { await enviarAvisoCaePendiente(emitidas, fecha); }
        catch (e: any) { console.error('[ventas/cargar] error enviando aviso de CAEs pendientes:', e); }
      }
    } catch (e: any) {
      console.error('[ventas/cargar] excepción al emitir a Xubio:', e);
      errores = [{ cliente: 'Xubio', error: e?.message || 'Error al emitir' }];
    }

    // Enviar el resumen de lo que haya quedado pendiente (errores) por mail
    let mail = false;
    try { const r = await enviarResumenPendientes(); mail = !!r.ok && (r.facturas || 0) > 0; } catch {}

    const clientes = idControls.length;
    return NextResponse.json({ ok: true, lineas: aCargar.length, clientes, mail, emitidas, errores });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
