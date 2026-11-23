// ── Nota de crédito por un importe, no por cantidades ────────────────────────────────
//
// El caso que lo pidió: La Gallega reclama un 20% sobre una factura por un acuerdo
// comercial. No se entregó nada de menos —las cantidades están bien— y sin embargo hay que
// acreditarle plata.
//
// La NC que ya existía sale de las CANTIDADES: se corrigen los kilos y de ahí sale el
// comprobante. Para un descuento comercial eso no sirve: habría que inventar que se
// entregaron 20 kilos menos, y la factura quedaría diciendo algo que no pasó.
//
// ── Cómo se arma la NC de un importe suelto ──
//
// Xubio pide líneas con producto, cantidad y precio. Dos formas de llegar a un importe:
//
//  · Un renglón genérico tipo "DESCUENTO". Necesita que ese producto exista en Xubio, y si
//    no existe la NC se rechaza entera. Es una dependencia invisible: funciona hasta el día
//    que alguien limpia el catálogo.
//
//  · Las MISMAS líneas de la factura, con las mismas cantidades, al precio proporcional
//    que suma el importe a acreditar. Es lo que se hace acá. No hace falta crear nada en
//    Xubio, la NC se lee al lado de su factura y el IVA sale sobre los mismos artículos,
//    que es lo que un descuento comercial es en realidad: menos plata por lo mismo.
//
// ── El redondeo, que importa ──
//
// Prorratear y redondear cada línea deja una diferencia de centavos contra el total. En una
// NC esa diferencia no es estética: es lo que hace que la deuda del cliente no cierre por
// $3 para siempre. La sobra se le carga a la línea más grande, que es donde menos se nota
// en el precio unitario.

export interface LineaFactura {
  // Lo que identifica la línea en la factura original.
  id_venta: string;
  key: string;
  sucursal?: string;
  cantidad: number;
  precio: number;
}

export interface LineaCredito {
  id_venta: string;
  key: string;
  sucursal?: string;
  cantidad: number;
  // El precio unitario de la NC: el de la factura por la proporción que se acredita.
  precio: number;
  importe: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function totalDe(lineas: LineaFactura[]): number {
  return r2((lineas || []).reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0));
}

export interface ResultadoCredito {
  ok: boolean;
  error?: string;
  lineas: LineaCredito[];
  importe: number;
  // Qué proporción de la factura se está acreditando, para poder decirlo en pantalla.
  porcentaje: number;
}

// Reparte `aCreditar` entre las líneas, proporcional a lo que pesa cada una.
export function lineasParaCredito(lineas: LineaFactura[], aCreditar: number): ResultadoCredito {
  const validas = (lineas || []).filter((l) => (Number(l.cantidad) || 0) > 0 && (Number(l.precio) || 0) > 0);
  const total = totalDe(validas);
  const credito = r2(Number(aCreditar) || 0);

  if (!validas.length) return { ok: false, error: 'La factura no tiene líneas con cantidad y precio para prorratear.', lineas: [], importe: 0, porcentaje: 0 };
  if (!(credito > 0)) return { ok: false, error: 'El importe a acreditar tiene que ser mayor a cero.', lineas: [], importe: 0, porcentaje: 0 };
  // Acreditar más que la factura no es una nota de crédito: es regalar plata que nadie
  // facturó. Xubio lo aceptaría y la cuenta corriente quedaría en negativo.
  if (credito > total + 0.01) {
    return { ok: false, error: `No se puede acreditar $${Math.round(credito).toLocaleString('es-AR')}: la factura es de $${Math.round(total).toLocaleString('es-AR')}.`, lineas: [], importe: 0, porcentaje: 0 };
  }

  const prop = credito / total;
  const out: LineaCredito[] = validas.map((l) => {
    const cant = Number(l.cantidad) || 0;
    const precio = r2((Number(l.precio) || 0) * prop);
    return { id_venta: l.id_venta, key: l.key, sucursal: l.sucursal, cantidad: cant, precio, importe: r2(cant * precio) };
  });

  // La sobra del redondeo va a la línea más grande. Sin esto, la NC suma unos centavos
  // distinto del descuento acordado y la diferencia queda abierta en la cuenta del cliente.
  const sumado = r2(out.reduce((a, l) => a + l.importe, 0));
  const sobra = r2(credito - sumado);
  if (Math.abs(sobra) >= 0.01) {
    const i = out.reduce((mejor, l, idx) => (l.importe > out[mejor].importe ? idx : mejor), 0);
    const nuevaImporte = r2(out[i].importe + sobra);
    out[i] = { ...out[i], importe: nuevaImporte, precio: r2(nuevaImporte / out[i].cantidad) };
  }

  // Las líneas que quedaron en cero no se mandan: un renglón de $0 en una NC es ruido que
  // alguien va a tener que explicar.
  const conImporte = out.filter((l) => l.importe > 0 && l.precio > 0);
  const importe = r2(conImporte.reduce((a, l) => a + l.importe, 0));

  return { ok: true, lineas: conImporte, importe, porcentaje: Math.round((importe / total) * 1000) / 10 };
}

// Lo que hay que acreditar para que la factura quede en `importeFinal`.
export function creditoParaLlegarA(total: number, importeFinal: number): number {
  return r2((Number(total) || 0) - (Number(importeFinal) || 0));
}

// El importe final que deja un descuento del N%. Es la forma en que se pide el descuento
// comercial ("un 20%"), y hacer la cuenta a mano es donde se cuela el error.
export function importeConDescuento(total: number, pct: number): number {
  const p = Number(pct) || 0;
  return r2((Number(total) || 0) * (1 - p / 100));
}
