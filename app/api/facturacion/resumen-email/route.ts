import { NextRequest, NextResponse } from 'next/server';
import { enviarResumenPendientes } from '@/lib/resumenFacturacion';

export const dynamic = 'force-dynamic';

// Resumen diario por mail de las ventas cargadas pendientes de facturar.
// Lo dispara Vercel Cron (vercel.json) una vez por día.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const r = await enviarResumenPendientes();
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error' }, { status: 500 });
  }
}
