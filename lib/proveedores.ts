// ── Lo que se compró y todavía no se pagó ────────────────────────────────────────────
//
// Hasta acá un gasto se cargaba cuando salía la plata, así que la app no tenía forma de
// saber cuánto se debe: una compra a 30 días simplemente no existía hasta el día que se
// pagaba, y el mes en que se pagaba cargaba con un gasto de otro mes.
//
// Ahora una compra se puede cargar como PENDIENTE, con proveedor y vencimiento, y marcarse
// pagada después. Eso es lo que convierte "gastos" en "cuenta corriente de proveedores".
//
// ── Por qué lo pendiente no toca ningún número existente ──
//
// Un gasto pendiente NO entra en el EERR, ni en los saldos de caja, ni en los totales de
// Gastos: para todo eso sigue valiendo lo mismo que antes, que es la plata que salió. Es
// deliberado y es conservador: meterlo cambiaría resultados de meses ya cerrados según un
// criterio contable (devengado vs. caja) que todavía no está definido, y un EERR que cambia
// solo es peor que uno incompleto.
//
// Cuando se marca pagada, la compra pasa a ser un gasto normal con la fecha en que se pagó,
// y a partir de ahí entra en todo como siempre.

import type { Gasto } from './types';

export const ESTADO_PENDIENTE = 'pendiente';

// Un gasto cuenta como plata que salió salvo que esté marcado como pendiente. El default
// es "pagado" a propósito: las miles de filas cargadas antes de esto no tienen la columna,
// y tratarlas como pendientes vaciaría el EERR de un año entero.
export function estaPagado(g: Gasto): boolean {
  return String((g as any)?.estado_pago || '').trim().toLowerCase() !== ESTADO_PENDIENTE;
}

export function soloPagados(gastos: Gasto[]): Gasto[] {
  return (gastos || []).filter(estaPagado);
}

export interface DeudaProveedor {
  proveedor: string;
  total: number;
  vencido: number;      // lo que ya pasó su fecha de vencimiento
  items: {
    id_gasto: string;
    fecha: string;        // cuándo se compró
    vencimiento: string;  // cuándo hay que pagarlo
    descripcion: string;
    monto: number;
    diasParaVencer: number | null; // negativo = vencido
  }[];
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

function diasEntre(desde: string, hasta: string): number | null {
  if (!desde || !hasta) return null;
  const a = new Date(desde + 'T12:00:00').getTime();
  const b = new Date(hasta + 'T12:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

// Lo que se debe hoy, agrupado por proveedor y de lo más vencido a lo que falta más.
export function deudaProveedores(gastos: Gasto[], hoy: string): DeudaProveedor[] {
  const porProveedor = new Map<string, DeudaProveedor>();
  for (const g of gastos || []) {
    if (estaPagado(g)) continue;
    const proveedor = String((g as any)?.proveedor || '').trim() || 'Sin proveedor';
    const vencimiento = soloFecha((g as any)?.vencimiento);
    const monto = Number(g?.monto) || 0;
    const dias = vencimiento ? diasEntre(hoy, vencimiento) : null;
    const d = porProveedor.get(proveedor) || { proveedor, total: 0, vencido: 0, items: [] };
    d.total += monto;
    if (dias !== null && dias < 0) d.vencido += monto;
    d.items.push({
      id_gasto: String(g.id_gasto),
      fecha: soloFecha(g.fecha),
      vencimiento,
      descripcion: String(g.descripcion || ''),
      monto,
      diasParaVencer: dias,
    });
    porProveedor.set(proveedor, d);
  }
  for (const d of porProveedor.values()) {
    // Lo que vence antes, primero: es el orden en el que hay que pagar.
    d.items.sort((a, b) => {
      if (!a.vencimiento) return 1;
      if (!b.vencimiento) return -1;
      return a.vencimiento.localeCompare(b.vencimiento);
    });
  }
  // Primero el que tiene algo vencido, y dentro de eso el que más debe.
  return [...porProveedor.values()].sort((a, b) => (b.vencido - a.vencido) || (b.total - a.total));
}

// Cuánto vence dentro de los próximos N días, para la proyección del mes.
export function aVencerEn(gastos: Gasto[], hoy: string, dias: number): number {
  let total = 0;
  for (const g of gastos || []) {
    if (estaPagado(g)) continue;
    const v = soloFecha((g as any)?.vencimiento);
    const d = v ? diasEntre(hoy, v) : null;
    // Lo ya vencido también entra: se debe y hay que pagarlo, no deja de contar por atrasado.
    if (d === null || d <= dias) total += Number(g?.monto) || 0;
  }
  return total;
}
