import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Lote, VentaDia, StockCamara } from '@/lib/types';
import { calcularCamara } from '@/lib/camara';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  const [registros, lotes, ventas] = await Promise.all([
    readSheet<StockCamara>('StockCamara'),
    readSheet<Lote>('Lotes'),
    readSheet<VentaDia>('Ventas'),
  ]);

  const rucula  = calcularCamara('rucula',  registros, lotes, ventas);
  const lechuga = calcularCamara('lechuga', registros, lotes, ventas);

  return NextResponse.json({ rucula, lechuga });
}
