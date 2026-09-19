// ── Aviso: entregas que se cobran en el momento ──────────────────────────────────────
//
// Hay sucursales que le pagan al repartidor contra entrega. Si Marcos no se entera de que
// ese día hay un pedido para una de ellas, el repartidor va sin saber que tiene que cobrar
// y la plata queda para la próxima — o se pierde el viaje.
//
// El aviso sale cuando se cargan las ventas del día, que es el momento en que todavía se
// puede llamar al repartidor. Después ya no sirve.

import type { VentaDia, ClienteVenta } from './types';

// Qué combinaciones cliente + sucursal se cobran en la entrega. Se compara sin acentos y
// sin mayúsculas, y por "contiene", porque el nombre de la sucursal en la hoja no siempre
// se escribe igual ("Uriburu", "La Esperanza Uriburu", "uriburu 2500").
export const COBRO_EN_ENTREGA: { cliente: string; sucursales: string[] }[] = [
  { cliente: 'esperanza', sucursales: ['uriburu', 'sur'] },
];

const norm = (s: any) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const PROD_LABELS: Record<string, string> = {
  rucula: 'Rúcula', lechuga_crespa: 'Lechuga crespa', hoja_roble: 'Hoja de roble',
  bandeja_rucula: 'Bandeja de rúcula', albahaca: 'Albahaca',
  rucula_kg: 'Rúcula (kg)', lechuga_kg: 'Lechuga (kg)',
  lechuga_kg_crespa: 'Lechuga crespa (kg)', lechuga_kg_roble: 'Lechuga roble (kg)',
};

export interface EntregaConCobro {
  cliente: string;
  sucursal: string;
  fecha: string;
  items: { producto: string; cantidad: number }[];
}

// Las ventas de `fecha` que caen en una sucursal de cobro contra entrega.
export function entregasConCobro(ventas: VentaDia[], clientes: ClienteVenta[], fecha: string): EntregaConCobro[] {
  const out: EntregaConCobro[] = [];
  for (const v of ventas) {
    if (String(v.fecha || '').split(/[T ]/)[0] !== fecha) continue;
    const cliente = clientes.find(c => String(c.id_control) === String(v.id_control));
    const nombreCliente = norm(cliente?.nombre_xubio || v.nombre_cliente);
    const sucursal = norm(v.sucursal);
    const regla = COBRO_EN_ENTREGA.find(r =>
      nombreCliente.includes(norm(r.cliente)) && r.sucursales.some(suc => sucursal.includes(norm(suc))));
    if (!regla) continue;

    const items: { producto: string; cantidad: number }[] = [];
    for (const [key, label] of Object.entries(PROD_LABELS)) {
      const qty = Number((v as any)[key]) || 0;
      if (qty > 0) items.push({ producto: label, cantidad: qty });
    }
    if (!items.length) continue;

    // Dos filas de la misma sucursal el mismo día son una sola entrega.
    const ya = out.find(e => e.cliente === (cliente?.nombre_xubio || v.nombre_cliente) && e.sucursal === v.sucursal);
    if (ya) {
      for (const it of items) {
        const prev = ya.items.find(x => x.producto === it.producto);
        if (prev) prev.cantidad += it.cantidad;
        else ya.items.push(it);
      }
    } else {
      out.push({ cliente: cliente?.nombre_xubio || String(v.nombre_cliente || ''), sucursal: v.sucursal, fecha, items });
    }
  }
  return out;
}

// Mail a administración. No va al cliente ni al repartidor: es para que Marcos avise.
export async function avisarCobroEnEntrega(entregas: EntregaConCobro[], destinatarios: string[]): Promise<boolean> {
  if (!entregas.length || !destinatarios.length) return false;
  if (!process.env.RESEND_API_KEY) { console.error('[avisoCobroEntrega] RESEND_API_KEY no configurada'); return false; }

  const fmtDia = (f: string) => { const [y, m, d] = String(f).split('-'); return d ? `${d}/${m}/${y}` : f; };
  const bloques = entregas.map(e => `
    <div style="margin:0 0 12px;padding:10px 12px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px">
      <p style="margin:0;font-size:15px;font-weight:700;color:#111">${e.cliente} — ${e.sucursal}</p>
      <p style="margin:4px 0 0;font-size:14px;color:#111">
        ${e.items.map(i => `<strong>${i.cantidad.toLocaleString('es-AR')}</strong> ${i.producto}`).join(' · ')}
      </p>
    </div>`).join('');

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
      <h2 style="margin:0 0 4px">Hay que avisarle al repartidor que cobre</h2>
      <p style="margin:0 0 12px;color:#555">Entregas del ${fmtDia(entregas[0].fecha)} en sucursales que pagan contra entrega.</p>
      ${bloques}
      <p style="margin:14px 0 0;color:#555;font-size:13px">Este aviso sale al cargar las ventas del día, para que todavía se pueda avisar antes del reparto.</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: `Cobrar en la entrega — ${entregas.map(e => e.sucursal).join(', ')} — ${fmtDia(entregas[0].fecha)}`,
        html,
      }),
    });
    if (!res.ok) console.error('[avisoCobroEntrega] Resend rechazó el aviso:', await res.json().catch(() => ({})));
    return res.ok;
  } catch (e) {
    console.error('[avisoCobroEntrega] excepción enviando el aviso:', e);
    return false;
  }
}
