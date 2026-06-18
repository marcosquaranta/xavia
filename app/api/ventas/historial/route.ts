import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia, ConfigItem } from '@/lib/types';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const [ventas, config] = await Promise.all([
      readSheet<VentaDia>('Ventas'),
      readSheet<ConfigItem>('Config'),
    ]);
    // Agrupar por fecha con resumen
    const porFecha = new Map<string, { fecha: string; clientes: number; exportado: boolean; rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number }>();
    for (const v of ventas) {
      if (!v.fecha) continue;
      const f = String(v.fecha).split(/[\sT]/)[0];
      const ex = porFecha.get(f) || { fecha: f, clientes: 0, exportado: false, rucula: 0, lechuga: 0, rucula_kg: 0, lechuga_kg: 0 };
      ex.clientes++;
      ex.rucula += Number(v.rucula || 0);
      ex.lechuga += Number(v.lechuga_crespa || 0) + Number(v.hoja_roble || 0);
      ex.rucula_kg += Number(v.rucula_kg || 0);
      ex.lechuga_kg += Number(v.lechuga_kg || 0);
      if (v.exportado === 'SI') ex.exportado = true;
      porFecha.set(f, ex);
    }
    const fechas = [...porFecha.values()].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 30);
    const lastA = Number(config.find(c => c.clave === 'last_factura_a')?.valor || 665);
    const lastB = Number(config.find(c => c.clave === 'last_factura_b')?.valor || 575);
    return NextResponse.json({ fechas, lastA, lastB });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
