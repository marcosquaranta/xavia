import { readSheet } from './sheets';
import type { ClienteVenta, PrecioVenta, VentaDia } from './types';

const PRODS = ['rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca', 'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'];
const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

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

// Arma y envía por mail el resumen de las ventas cargadas pendientes de facturar.
// Reutilizado por el cron diario y por "Cargar ventas".
export async function enviarResumenPendientes(): Promise<{ ok: boolean; facturas: number; total?: number; msg?: string; error?: string }> {
  const [clientes, precios, ventas] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    readSheet<PrecioVenta>('Precios'),
    readSheet<VentaDia>('Ventas'),
  ]);

  const pendientes = ventas.filter(v => v.exportado === 'PENDIENTE');
  if (!pendientes.length) return { ok: true, facturas: 0, msg: 'Sin ventas pendientes' };

  // Mismo criterio de agrupación que emitirPendientes() en lib/facturacionEmitir.ts: los
  // clientes con facturar_por_sucursal='SI' se desglosan por sucursal acá también, para
  // que este resumen anticipe exactamente cuántas facturas van a salir (no menos de las
  // que realmente se van a emitir).
  const clientesMap = new Map(clientes.map(c => [c.id_control, c]));
  interface Grupo { idControl: string; sucursal: string | null; lineas: VentaDia[] }
  const grupos = new Map<string, Grupo>();
  for (const v of pendientes) {
    const cliente = clientesMap.get(v.id_control);
    const porSucursal = cliente?.facturar_por_sucursal === 'SI';
    const sucursal = porSucursal ? (v.sucursal || '(sin sucursal)') : null;
    const key = porSucursal ? `${v.id_control}||${sucursal}` : v.id_control;
    if (!grupos.has(key)) grupos.set(key, { idControl: v.id_control, sucursal, lineas: [] });
    grupos.get(key)!.lineas.push(v);
  }

  const fmtFecha = (s: string) => { const [y, m, d] = String(s || '').split(/[T ]/)[0].split('-'); return d && m ? `${d}/${m}` : String(s || ''); };

  const filas: { cliente: string; letra: string; unidades: number; total: number; fechas: string }[] = [];
  for (const { idControl, sucursal, lineas: lineasV } of grupos.values()) {
    const cliente = clientesMap.get(idControl);
    let total = 0, unidades = 0;
    for (const l of lineasV) {
      for (const key of PRODS) {
        const qty = Number((l as any)[key]) || 0;
        if (qty <= 0) continue;
        unidades += qty;
        total += qty * getPrecio(precios, idControl, l.sucursal, key, cliente?.sucursales);
      }
    }
    if (unidades <= 0) continue;
    const fechas = Array.from(new Set(lineasV.map(l => String(l.fecha || '').split(/[T ]/)[0]).filter(Boolean))).sort().map(fmtFecha).join(', ');
    const nombreBase = cliente?.nombre_display || cliente?.nombre_xubio || idControl;
    filas.push({ cliente: sucursal ? `${nombreBase} (${sucursal})` : nombreBase, letra: cliente?.tipo_factura || '?', unidades, total, fechas });
  }
  if (!filas.length) return { ok: true, facturas: 0, msg: 'Sin unidades' };
  filas.sort((a, b) => b.total - a.total);

  const grandTotal = filas.reduce((a, f) => a + f.total, 0);
  const totalU = filas.reduce((a, f) => a + f.unidades, 0);
  const nA = filas.filter(f => f.letra === 'A').length;
  const nB = filas.filter(f => f.letra === 'B').length;
  const hoy = new Date().toLocaleDateString('es-AR');

  if (!process.env.RESEND_API_KEY) return { ok: false, facturas: filas.length, error: 'RESEND_API_KEY no configurada' };

  const rows = filas.map(f => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${f.cliente}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">${f.fechas}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${f.letra}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${f.unidades.toLocaleString('es-AR')} u</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fmt(f.total)}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:600px">
      <h2 style="margin:0 0 4px">Facturación pendiente — ${hoy}</h2>
      <p style="margin:0 0 14px;color:#555">Tenés <strong>${filas.length}</strong> ventas cargadas sin facturar (${nA} A · ${nB} B) · <strong>${totalU.toLocaleString('es-AR')} u</strong> · <strong>${fmt(grandTotal)}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:6px 10px;text-align:left">Cliente</th>
          <th style="padding:6px 10px;text-align:left">Fecha</th>
          <th style="padding:6px 10px;text-align:center">Tipo</th>
          <th style="padding:6px 10px;text-align:right">Unidades</th>
          <th style="padding:6px 10px;text-align:right">Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="3" style="padding:8px 10px;font-weight:700;border-top:2px solid #ddd">Total</td>
          <td style="padding:8px 10px;text-align:right;font-weight:700;border-top:2px solid #ddd">${totalU.toLocaleString('es-AR')} u</td>
          <td style="padding:8px 10px;text-align:right;font-weight:800;border-top:2px solid #ddd">${fmt(grandTotal)}</td>
        </tr></tfoot>
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
    return { ok: false, facturas: filas.length, error: (err as any).message || `HTTP ${res.status}` };
  }
  return { ok: true, facturas: filas.length, total: grandTotal };
}
