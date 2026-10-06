// ── Cuánto retuvo el cliente ────────────────────────────────────────────
//
// El porcentaje se aplica DIRECTO sobre el importe del cobro: 2% de lo que entró.
//
// Al principio esto hacía la cuenta al revés (reconstruir la factura desde el depósito y
// sacarle el 2% a esa), que da 2,04% del depósito en vez de 2%. Marcos lo comparó contra los
// comprobantes de retención reales y es el 2% a secas. Manda el comprobante, no el modelo.
//
// Igual el número queda editable en la pantalla: si un comprobante trae otra cosa —un
// mínimo, un tope, un ajuste— se escribe a mano y eso gana.

export const CUENTA_RETENCION_PREFERIDA = /retenci[oó]n\s+ganancias\s+sufrida/i;

export function porcentajeRetencion(cliente: { retencion_ganancias_pct?: number | string } | undefined | null): number {
  const n = Number(cliente?.retencion_ganancias_pct);
  // Un porcentaje fuera de 0-50 es un error de carga: 100 dejaría la cuenta en infinito.
  return Number.isFinite(n) && n > 0 && n < 50 ? n : 0;
}

// El p% del importe, redondeado al peso.
export function retencionDesdeImporte(importeRecibido: number, pct: number): number {
  const r = Number(importeRecibido) || 0;
  const p = Number(pct) || 0;
  if (!(r > 0) || !(p > 0) || p >= 100) return 0;
  return Math.round((r * p) / 100);
}

// A qué cuenta de Xubio va. Por ahora siempre ganancias, que es la única que aplica; si esa
// cuenta no estuviera, se cae a cualquier retención sufrida y después a una de impuestos,
// antes que no poder registrar el cobro.
export function cuentaParaRetencion<T extends { id: number; nombre: string }>(cuentas: T[]): T | undefined {
  const lista = cuentas || [];
  return lista.find((c) => CUENTA_RETENCION_PREFERIDA.test(c.nombre))
    || lista.find((c) => /retenci[oó]n/i.test(c.nombre) && /sufrid/i.test(c.nombre))
    || lista.find((c) => /impuesto/i.test(c.nombre));
}
