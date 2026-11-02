// ── Adelantos de sueldo ──────────────────────────────────────────────────────────────
//
// Un adelanto no es un gasto más del mes: es parte del sueldo, pagada antes. Se carga en
// Gastos igual —la plata salió de una caja y tiene que figurar en el resultado— pero con
// categoría propia y atado a un empleado, para poder descontarlo a fin de mes.
//
// Sin esto pasaba lo peor de los dos mundos: o el adelanto no se registraba en ningún lado
// y la caja no cerraba, o se registraba suelto y a fin de mes se pagaba el sueldo entero,
// o sea dos veces.

import type { Gasto } from './types';

export const CATEGORIA_ADELANTO = 'adelanto_sueldo';

// Cuánto se le adelantó a cada empleado dentro de un rango de fechas (YYYY-MM-DD).
// La clave es el workno, que es como se identifica al empleado en todo el módulo.
export function adelantosPorEmpleado(gastos: Gasto[], desde: string, hasta: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of gastos || []) {
    if (String(g?.categoria) !== CATEGORIA_ADELANTO) continue;
    const workno = String((g as any)?.empleado || '').trim();
    // Un adelanto sin empleado no se puede descontar de nadie. No se reparte ni se adivina:
    // queda como gasto y la pantalla de personal avisa que hay adelantos sin asignar.
    if (!workno) continue;
    const f = String(g?.fecha || '').split(/[T ]/)[0];
    if (!f || f < desde || f > hasta) continue;
    out[workno] = (out[workno] || 0) + (Number(g?.monto) || 0);
  }
  return out;
}

// ── El detalle, no solo el total ─────────────────────────────────────────────────────
//
// La pantalla de sueldos mostraba "− $120.000" y nada más. Cuando el número no es el que
// esperabas no hay forma de saber de qué adelantos se compone, y corregir uno significaba
// ir a Gastos, buscar la fila entre cientos y volver.
//
// Devuelve las filas tal cual están en Gastos, con su id: lo que se edite desde sueldos se
// edita sobre el gasto, no sobre una copia. Un adelanto es plata que salió de una caja —por
// eso vive en Gastos— y tener el número en dos lugares haría que la caja y el sueldo
// puedan decir cosas distintas sobre el mismo adelanto.
export interface AdelantoDetalle {
  id_gasto: string;
  fecha: string;
  monto: number;
  descripcion: string;
  medio_pago: string;
}

export function adelantosDetallePorEmpleado(
  gastos: Gasto[], desde: string, hasta: string,
): Record<string, AdelantoDetalle[]> {
  const out: Record<string, AdelantoDetalle[]> = {};
  for (const g of gastos || []) {
    if (String(g?.categoria) !== CATEGORIA_ADELANTO) continue;
    const workno = String((g as any)?.empleado || '').trim();
    if (!workno) continue;
    const f = String(g?.fecha || '').split(/[T ]/)[0];
    if (!f || f < desde || f > hasta) continue;
    (out[workno] ||= []).push({
      id_gasto: String(g.id_gasto),
      fecha: f,
      monto: Number(g?.monto) || 0,
      descripcion: String(g?.descripcion || ''),
      medio_pago: String((g as any)?.medio_pago || ''),
    });
  }
  // Del más viejo al más nuevo, que es el orden en que se entregaron.
  for (const l of Object.values(out)) l.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return out;
}

// Los que quedaron sin empleado asignado en el rango: se avisan en pantalla en vez de
// descontarlos mal o ignorarlos en silencio.
export function adelantosSinAsignar(gastos: Gasto[], desde: string, hasta: string): Gasto[] {
  return (gastos || []).filter((g) => {
    if (String(g?.categoria) !== CATEGORIA_ADELANTO) return false;
    if (String((g as any)?.empleado || '').trim()) return false;
    const f = String(g?.fecha || '').split(/[T ]/)[0];
    return !!f && f >= desde && f <= hasta;
  });
}
