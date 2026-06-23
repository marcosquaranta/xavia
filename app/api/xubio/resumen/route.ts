import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUltimosNumerosPorPV, getVentasMensuales } from '@/lib/xubio';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const [ultimos, mensuales] = await Promise.all([
      getUltimosNumerosPorPV(),
      getVentasMensuales(6),
    ]);
    return NextResponse.json({ ultimos, mensuales });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error consultando Xubio' }, { status: 500 });
  }
}
