// ── Lo facturado y lo que quedó sin facturar ─────────────────────────────────────────
//
// Los tipos y el agrupado de la pantalla de historial. Viven acá y no en la ruta porque los
// usan tres lugares: la API que arma la pantalla, el aviso por mail de lo que quedó sin
// facturar, y la sección de alertas de Ventas. Tres lecturas distintas de la misma cosa es
// exactamente cómo se termina con tres definiciones de "está sin facturar".

// Las cuatro columnas de siempre ya salen agrupadas aparte (rúcula y lechuga suman sus
// variedades, los kg suman la columna vieja y las dos nuevas). Todo lo demás —albahaca,
// ensaladas, microgreens, lo que se dé de alta mañana— va al bolsón de `otros`.
export const KEYS_ROLLUP = new Set([
  'rucula', 'lechuga_crespa', 'hoja_roble',
  'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble',
]);

export interface EntradaExpCliente {
  id_exportacion: string; fecha: string; fecha_exportacion: string; cliente: string; id_control: string;
  // Las sucursales que entraron en esa factura. La línea sigue siendo por cliente —así se
  // factura—, pero sin esto no se puede filtrar por sucursal, que es como se busca cuando
  // el reclamo viene de una sucursal puntual.
  sucursales: string[];
  rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
  otros: Record<string, number>;
}

export interface EntradaPend {
  fecha: string;
  id_control: string;
  cliente: string;
  filas: number;
  sucursales: string[];
  rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
  otros: Record<string, number>;
  // Las facturas que SÍ salieron a ese cliente ese mismo día. Es la primera pregunta cuando
  // aparece algo sin facturar: casi siempre el cliente se facturó en otra tanda y lo que
  // quedó suelto es una fila cargada dos veces. Sin este dato hay que ir a buscarlo a la
  // otra tabla y cruzarlo a ojo.
  facturadoMismoDia: { id_exportacion: string; fecha_exportacion: string }[];
  // Se marcó para facturar (exportado = PENDIENTE) pero Xubio no llegó a emitirla. No está
  // facturada: se reintenta desde Facturación.
  marcada?: boolean;
}

// Suma al acumulador lo cargado en los artículos que no son de las cuatro columnas fijas.
// Solo lo que tiene cantidad: una venta de rúcula no tiene por qué arrastrar quince ceros.
export function otrosDeVenta(v: any, keys: string[], acc: Record<string, number>): Record<string, number> {
  for (const k of keys) {
    const n = Number(v?.[k]) || 0;
    if (n) acc[k] = (acc[k] || 0) + n;
  }
  return acc;
}

// Cuántos días pasaron desde una fecha ISO hasta otra.
export function diasEntreISO(desde: string, hasta: string): number {
  const a = new Date(String(desde) + 'T12:00:00').getTime();
  const b = new Date(String(hasta) + 'T12:00:00').getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : 0;
}
