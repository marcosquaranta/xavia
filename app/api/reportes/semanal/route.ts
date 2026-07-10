import { NextRequest, NextResponse } from 'next/server';
import { enviarReporteSemanal } from '@/lib/reporteSemanal';

export const dynamic = 'force-dynamic';

// Reporte semanal por mail (ventas, cosecha, ciclos, ocupación, siembra, alertas).
// Lo dispara Vercel Cron (vercel.json) todos los viernes a las 8am (ART).
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const r = await enviarReporteSemanal();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
