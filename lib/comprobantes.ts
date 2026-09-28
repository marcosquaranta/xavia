// ── Comparar números de comprobante ──────────────────────────────────────────────────
//
// "A-00002-00000878" no siempre viene escrito igual: Xubio lo devuelve con ceros a la
// izquierda, una persona lo escribe "A 2-878", y una comparación literal entre esas dos
// formas da distinto. Eso no es un detalle estético: es lo que hace que una factura ya
// cobrada se siga ofreciendo para cobrar de nuevo.
//
// La clave se queda con la letra —que distingue una A de una B del mismo número— y con los
// dígitos sin ceros a la izquierda, que es la parte que identifica al comprobante.

export function claveComprobante(numero: any): string {
  const t = String(numero ?? '').trim().toUpperCase();
  if (!t) return '';
  const letra = t.match(/^([A-Z])[\s-]/)?.[1] || '';
  // Los grupos de dígitos, cada uno sin ceros adelante: "A-00002-00000878" → "2-878".
  const partes = t.replace(/^[A-Z][\s-]/, '').split(/[^0-9]+/).filter(Boolean)
    .map((p) => String(Number(p)));
  if (!partes.length) return t.replace(/[^A-Z0-9]/g, '');
  return `${letra}${partes.join('-')}`;
}

// Un Set de claves, para preguntar rápido si un comprobante ya está en una lista.
export function clavesDe(numeros: Iterable<any>): Set<string> {
  const out = new Set<string>();
  for (const n of numeros) {
    const k = claveComprobante(n);
    if (k) out.add(k);
  }
  return out;
}
