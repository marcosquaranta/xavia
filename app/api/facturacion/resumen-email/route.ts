import { NextRequest, NextResponse } from 'next/server';
import { readSheet } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PRODS = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg'];

function getPrecio(precios: PrecioVenta[], id_control: string, sucursal: string, key: string, clienteSucursales?: string): number {
  let row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal);
  if (!row && clienteSucursales) {
    for (const s of clienteSucursales.split('|').map(s => s.trim()).filter(Boolean)) {
      row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === s);
      if (row) break;
    }
  }
  if (!row) row = precios.find(p => String(p.id_control) === String(id_control));
  if (!row) return 0;
  return Number((row as any)[key] || 0);
}

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

// Resumen diario por mail de las ventas cargadas pendientes de facturar.
// Lo dispara Vercel Cron (vercel.json) una vez por día.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [clientes, precios, ventas] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'),
      readSheet<PrecioVenta>('Precios'),
      readSheet<VentaDia>('Ventas'),
    ]);

    const pendientes = ventas.filter(v => v.exportado === 'PENDIENTE');
    if (!pendientes.length) {
      return NextResponse.json({ ok: true, msg: 'Sin ventas pendientes, no se envía mail' });
    }

    // Agrupar por cliente
    const porControl = new Map<string, VentaDia[]>();
    for (const v of pendientes) { const a = porControl.get(v.id_control) || []; a.push(v); porControl.set(v.id_control, a); }

    const filas: { cliente: string; letra: string; total: number }[] = [];
    for (const [idControl, lineasV] of porControl) {
      const cliente = clientes.find(c => c.id_control === idControl);
      let total = 0;
      for (const l of lineasV) {
        for (const key of PRODS) {
          const qty = Number((l as any)[key]) || 0;
          if (qty <= 0) continue;
          total += qty * getPrecio(precios, idControl, l.sucursal, key, cliente?.sucursales);
        }
      }
      if (total <= 0 && !lineasV.some(l => PRODS.some(k => Number((l as any)[k]) > 0))) continue;
      filas.push({ cliente: cliente?.nombre_display || cliente?.nombre_xubio || idControl, letra: cliente?.tipo_factura || '?', total });
    }
    filas.sort((a, b) => b.total - a.total);

    const grandTotal = filas.reduce((a, f) => a + f.total, 0);
    const nA = filas.filter(f => f.letra === 'A').length;
    const nB = filas.filter(f => f.letra === 'B').length;
    const hoy = new Date().toLocaleDateString('es-AR');

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: false, msg: 'RESEND_API_KEY no configurada', facturas: filas.length });
    }

    const rows = filas.map(f => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${f.cliente}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${f.letra}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fmt(f.total)}</td>
      </tr>`).join('');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
        <h2 style="margin:0 0 4px">Facturación pendiente — ${hoy}</h2>
        <p style="margin:0 0 14px;color:#555">Tenés <strong>${filas.length}</strong> ventas cargadas sin facturar (${nA} A · ${nB} B) por un total de <strong>${fmt(grandTotal)}</strong>.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:6px 10px;text-align:left">Cliente</th>
              <th style="padding:6px 10px;text-align:center">Tipo</th>
              <th style="padding:6px 10px;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding:8px 10px;font-weight:700;border-top:2px solid #ddd">Total</td>
              <td style="padding:8px 10px;text-align:right;font-weight:800;border-top:2px solid #ddd">${fmt(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
        <p style="margin:16px 0 0;color:#555;font-size:13px">Emitilas desde la sección <strong>Facturación</strong> en la app.</p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: ['administracion@xavia.com.ar'],
        subject: `Facturación pendiente — ${filas.length} ventas · ${fmt(grandTotal)}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json({ ok: false, error: (err as any).message || `HTTP ${res.status}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, facturas: filas.length, total: grandTotal });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error' }, { status: 500 });
  }
}
