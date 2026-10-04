// ── Cuánto retuvo el cliente ─────────────────────────────────────────────────────────
//
// La cuenta parece trivial y no lo es, y equivocarla deja la factura figurando impaga por
// la diferencia.
//
// Lo que se conoce es lo que ENTRÓ a la cuenta, no lo que decía la factura. Si la factura
// era F y el cliente retiene el p%, depositó F × (1 − p). O sea que, partiendo del depósito
// R, la retención NO es R × p —ese es el error fácil— sino R × p / (1 − p).
//
// Con 2% sobre un depósito de $98.000: lo correcto son $2.000 (factura $100.000), no $1.960.
// La diferencia es chica por cobro y se acumula factura tras factura.

export const CUENTA_RETENCION_PREFERIDA = /retenci[oó]n\s+ganancias\s+sufrida/i;

export function porcentajeRetencion(cliente: { retencion_ganancias_pct?: number | string } | undefined | null): number {
  const n = Number(cliente?.retencion_ganancias_pct);
  // Un porcentaje fuera de 0-50 es un error de carga: 100 dejaría la cuenta en infinito.
  return Number.isFinite(n) && n > 0 && n < 50 ? n : 0;
}

// La retención que explica un depósito, para un cliente que retiene p%.
export function retencionDesdeImporte(importeRecibido: number, pct: number): number {
  const r = Number(importeRecibido) || 0;
  const p = Number(pct) || 0;
  if (!(r > 0) || !(p > 0) || p >= 100) return 0;
  return Math.round((r * p) / (100 - p));
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
