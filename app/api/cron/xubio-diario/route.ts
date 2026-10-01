import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { guardarSnapshotXubio, HOJA_COMPROBANTES } from '@/lib/xubioCache';
import { readSheet } from '@/lib/sheets';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
// Xubio corta en 100 resultados por consulta y un rango grande se resuelve partiéndolo
// recursivamente: son decenas de llamadas encadenadas. Acá sí se puede esperar.
export const maxDuration = 300;

// ÚNICO punto de la app que le pide a Xubio comprobantes y cobranzas para mirar. Los guarda
// en XubioComprobantes y XubioCobranzas; las pantallas leen esas hojas, que es una lectura
// de Sheets normal (ver lib/xubioCache.ts).
//
// Ventana por defecto: los últimos 45 días. Se re-piden días ya guardados a propósito —un
// comprobante se puede anular o corregir después de emitido, y una caché que solo crece se
// queda con la versión vieja para siempre—. Para llenarla la primera vez, o para recuperar
// un hueco, se puede correr a mano con ?desde=&hasta= desde Cobranzas.
const DIAS_VENTANA = 45;
// Con la hoja vacía se trae un año y pico: es lo que miran las pantallas.
const DIAS_PRIMERA_CARGA = 400;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const hoy = fechaArgentinaHoy();
    const hasta = url.searchParams.get('hasta') || hoy;
    let desde = url.searchParams.get('desde') || '';
    if (!desde) {
      // La primera vez hay que llenar la caché entera, no los últimos 45 días: si no, las
      // pantallas —que miran un año— mostrarían mes y medio de facturas y parecería que
      // falta todo lo demás. Se detecta sola por la hoja vacía, para que no dependa de que
      // alguien se acuerde de pasar un rango a mano la primera vez.
      const yaHay = (await readSheet<any>(HOJA_COMPROBANTES).catch(() => [])).length > 0;
      const d = new Date(hoy + 'T12:00:00');
      d.setDate(d.getDate() - (yaHay ? DIAS_VENTANA : DIAS_PRIMERA_CARGA));
      desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    const r = await guardarSnapshotXubio(desde, hasta);
    return NextResponse.json({ ok: true, desde, hasta, ...r });
  } catch (e: any) {
    console.error('[cron/xubio-diario] error:', e);
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 });
  }
}
