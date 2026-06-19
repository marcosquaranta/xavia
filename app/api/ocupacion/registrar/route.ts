import { NextRequest, NextResponse } from 'next/server';
import { readSheet, appendRows } from '@/lib/sheets';
import { tubosPorMesada } from '@/lib/ocupacion';
import type { Lote, Ubicacion } from '@/lib/types';

// Llamado por Vercel Cron diariamente (vercel.json) y también desde /ocupacion al cargar
export async function GET(req: NextRequest) {
  // Verificar token de cron de Vercel
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const hoyStr = new Date().toISOString().split('T')[0];

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
