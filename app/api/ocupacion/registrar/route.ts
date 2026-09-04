import { NextRequest, NextResponse } from 'next/server';
import { readSheet, appendRows } from '@/lib/sheets';
import { tubosPorMesada, fechaArgentinaHoy } from '@/lib/ocupacion';
import type { Lote, Ubicacion } from '@/lib/types';

// Llamado por Vercel Cron todos los días a las 21hs ART (vercel.json) y también desde
// /ocupacion al cargar, como red de contención si el cron llegara a fallar un día.
//
// El cron se sacó una vez (jul-2026) por parecer redundante con el fallback de la página:
// si alguien entraba a /ocupacion, quedaba registrado igual. La falla de ese razonamiento
// es justamente los días en que NADIE entra — típicamente sábados — que quedaban sin
// ningún registro, y el promedio de ocupación (Estadísticas, reporte semanal) los saltea
// en silencio en vez de contarlos. Por eso el cron corre al CIERRE del día (21hs) y no a
// la mañana: para capturar el trabajo ya hecho ese día, trasplantes de sábado incluidos,
// en vez de la foto de antes de arrancar.
export async function GET(req: NextRequest) {
  // Verificar token de cron de Vercel
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fecha de ARGENTINA, no de UTC: el cron corre a las 21hs ART, que ya es medianoche
    // pasada en UTC — un `toISOString()` común etiquetaría la foto de hoy con la fecha de
    // mañana (ver el comentario de fechaArgentinaHoy en lib/ocupacion.ts).
    const hoyStr = fechaArgentinaHoy();

    const [lotes, ubicaciones, histRows] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Ubicacion>('Ubicaciones'),
      readSheet<{ fecha: string; mesada: string }>('OcupacionHistorial').catch(() => []),
    ]);

    // No duplicar si ya existe registro de hoy
    if (histRows.some(r => r.fecha === hoyStr)) {
      return NextResponse.json({ ok: true, msg: 'Ya registrado hoy', fecha: hoyStr });
    }

    const resumen = tubosPorMesada(ubicaciones, lotes);
    const rows: any[][] = [];
    for (const nave of resumen) {
      for (const m of nave.mesadas.filter(m => m.sector_fase !== 'fase_1')) {
        rows.push([hoyStr, m.nombre, m.nave, m.tubos_totales, m.tubos_ocupados, m.ocupacion_pct]);
      }
    }

    if (!rows.length) return NextResponse.json({ ok: false, msg: 'Sin mesadas activas' });

    await appendRows('OcupacionHistorial', rows);
    return NextResponse.json({ ok: true, fecha: hoyStr, mesadas: rows.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
