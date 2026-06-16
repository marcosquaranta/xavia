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

  // Factor de conversión: gramos por paquete desde último pesaje testigo registrado
  // Defaults: rúcula 210g (70g × 3 plantas), lechuga 330g
  function factorGr(cultivo: 'rucula' | 'lechuga'): number {
    const cosechasConPeso = lotes
      .filter(l => {
        if (l.estado !== 'cosechado') return false;
        const v = String(l.variedad || '').toLowerCase();
        const esRucula = v.includes('rucula') || v.includes('rúcula');
        if (cultivo === 'rucula' ? !esRucula : esRucula) return false;
        return Number(l.peso_muestra_paquete_gr) > 0;
      })
      .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')));
    if (cosechasConPeso.length > 0) return Number(cosechasConPeso[0].peso_muestra_paquete_gr);
    // También intentar con peso_muestra_kg (legado, en kg → convertir a gr)
    const conPesoKg = lotes
      .filter(l => {
        if (l.estado !== 'cosechado') return false;
        const v = String(l.variedad || '').toLowerCase();
        const esRucula = v.includes('rucula') || v.includes('rúcula');
        if (cultivo === 'rucula' ? !esRucula : esRucula) return false;
        return Number(l.peso_muestra_kg) > 0 && (l.destino_cosecha === 'paquete' || l.destino_cosecha === 'bandeja');
      })
      .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')));
    if (conPesoKg.length > 0) return Math.round(Number(conPesoKg[0].peso_muestra_kg) * 1000);
    return cultivo === 'rucula' ? 210 : 330;
  }

  const factorRucula  = factorGr('rucula');
  const factorLechuga = factorGr('lechuga');

  return NextResponse.json({ rucula, lechuga, factorGrPaq: { rucula: factorRucula, lechuga: factorLechuga } });
}
