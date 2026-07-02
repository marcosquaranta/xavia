import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { CATEGORIAS_GASTO, type Gasto } from '@/lib/types';
import * as XLSX from 'xlsx';

const LABEL_CAT: Record<string, string> = Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c.value, c.label]));
const ORDEN_CAT = CATEGORIAS_GASTO.map((c) => c.value);
const fmtFecha = (s: string) => { const [y, m, d] = String(s || '').split(/[T ]/)[0].split('-'); return d && m && y ? `${d}/${m}/${y}` : s; };

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { anio, mes } = await req.json();
    if (!anio || !mes) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });

    const gastos = await readSheet<Gasto>('Gastos');
    const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const finMes = new Date(Number(anio), Number(mes), 0).getDate();
    const fin = `${anio}-${String(mes).padStart(2, '0')}-${String(finMes).padStart(2, '0')}`;
    const delMes = gastos.filter((g) => {
      const f = String(g.fecha || '').split(/[T ]/)[0];
      return f >= inicio && f <= fin;
    });

    if (!delMes.length) return NextResponse.json({ error: 'sin_gastos_ese_mes' }, { status: 400 });

    const rows: any[][] = [];
    rows.push([`Gastos — ${String(mes).padStart(2, '0')}/${anio}`]);
    rows.push([]);
    rows.push(['Fecha', 'Categoría', 'Descripción', 'Medio de pago', 'Monto']);

    let granTotal = 0;
    const categoriasPresentes = Array.from(new Set(delMes.map((g) => g.categoria)))
      .sort((a, b) => ORDEN_CAT.indexOf(a) - ORDEN_CAT.indexOf(b));

    for (const cat of categoriasPresentes) {
      const deLaCat = delMes.filter((g) => g.categoria === cat).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
      let subtotal = 0;
      for (const g of deLaCat) {
        const monto = Number(g.monto) || 0;
        subtotal += monto; granTotal += monto;
        rows.push([fmtFecha(g.fecha), LABEL_CAT[g.categoria] || g.categoria, g.descripcion, g.medio_pago, monto]);
      }
      rows.push(['', '', '', `Subtotal ${LABEL_CAT[cat] || cat}`, subtotal]);
      rows.push([]);
    }

    rows.push(['', '', '', 'TOTAL GENERAL', granTotal]);
    rows.push([]);
    rows.push([]);

    // Totales por medio de pago
    rows.push(['Totales por medio de pago']);
    const mediosPresentes = Array.from(new Set(delMes.map((g) => g.medio_pago))).sort();
    for (const medio of mediosPresentes) {
      const total = delMes.filter((g) => g.medio_pago === medio).reduce((a, g) => a + (Number(g.monto) || 0), 0);
      rows.push([medio, total]);
    }
    rows.push(['TOTAL', granTotal]);
    rows.push([]);
    rows.push([`${delMes.length} gastos cargados`]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 40 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `xavia_gastos_${anio}-${String(mes).padStart(2, '0')}.xlsx`;
    return NextResponse.json({ ok: true, filename, file: Buffer.from(buf).toString('base64') });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
