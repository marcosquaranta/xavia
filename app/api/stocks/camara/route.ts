import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Lote, VentaDia, StockCamara } from '@/lib/types';
import { calcularCamara, type CultivoCamara } from '@/lib/camara';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  const [registros, lotes, ventas] = await Promise.all([
    readSheet<StockCamara>('StockCamara'),
    readSheet<Lote>('Lotes'),
    readSheet<VentaDia>('Ventas'),
  ]);

  const rucula = calcularCamara('rucula', registros, lotes, ventas);
  const lechugaCrespa = calcularCamara('lechuga_crespa', registros, lotes, ventas);
  const lechugaRoble = calcularCamara('lechuga_roble', registros, lotes, ventas);

  // Factor de conversión: gramos por paquete desde último pesaje testigo registrado
  // Defaults: rúcula 210g (70g × 3 plantas), lechuga 330g
  function factorGr(cultivo: CultivoCamara): number {
    const esVariedad = (v: string) => {
      const x = String(v || '').toLowerCase();
      const r = x.includes('rucula') || x.includes('rúcula');
      if (cultivo === 'rucula') return r;
      if (r) return false;
      return cultivo === 'lechuga_crespa' ? x.includes('crespa') : !x.includes('crespa');
    };
    const cosechasConPeso = lotes
      .filter(l => l.estado === 'cosechado' && esVariedad(l.variedad) && Number(l.peso_muestra_paquete_gr) > 0)
      .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')));
    if (cosechasConPeso.length > 0) return Number(cosechasConPeso[0].peso_muestra_paquete_gr);
    // También intentar con peso_muestra_kg (legado, en kg → convertir a gr)
    const conPesoKg = lotes
      .filter(l => l.estado === 'cosechado' && esVariedad(l.variedad) && Number(l.peso_muestra_kg) > 0 && (l.destino_cosecha === 'paquete' || l.destino_cosecha === 'bandeja'))
      .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')));
    if (conPesoKg.length > 0) return Math.round(Number(conPesoKg[0].peso_muestra_kg) * 1000);
    return cultivo === 'rucula' ? 210 : 330;
  }

  return NextResponse.json({
    rucula, lechuga_crespa: lechugaCrespa, lechuga_roble: lechugaRoble,
    factorGrPaq: { rucula: factorGr('rucula'), lechuga_crespa: factorGr('lechuga_crespa'), lechuga_roble: factorGr('lechuga_roble') },
  });
}
