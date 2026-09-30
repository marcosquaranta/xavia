// ── Qué vendemos ─────────────────────────────────────────────────────────────────────
//
// La lista de artículos estaba escrita a mano en veinticinco archivos: los tipos, los
// formularios de carga, los precios, los pedidos fijos, la facturación, las estadísticas y
// el mapeo a Xubio. Agregar uno significaba encontrar los veinticinco lugares, y el modo de
// fallar era el peor posible: la venta se cargaba bien y la factura salía sin ese ítem.
//
// Acá está la lista una sola vez. Lo demás la importa.
//
// ── Sobre dar de baja un artículo ───────────────────────────────────────────────────
//
// `activo: false` NO lo borra: lo saca de los formularios de carga y de precios, y lo deja
// funcionando para todo lo que mira hacia atrás. Las ventas viejas siguen en la planilla
// con su columna, y si se borrara la clave, esas ventas valdrían $0 en las estadísticas y
// desaparecerían de la facturación de meses cerrados. Dejar de vender algo no puede
// reescribir la historia.

export type UnidadArticulo = 'unidad' | 'kg';

export interface Articulo {
  key: string;
  label: string;        // corto, para encabezados de tabla angostos
  labelLargo: string;   // para mails y mensajes
  // El NOMBRE del producto en Xubio, tal cual está cargado allá. Tiene que coincidir
  // exacto: la conexión con Xubio es por nombre, no hay código aparte. Si no coincide, la
  // venta se carga bien y la factura sale sin ese ítem.
  xubio: string;
  unidad: UnidadArticulo;
  activo: boolean;
  color: string;
  // Si es uno de los tres principales de la pantalla de carga (los que se venden todos los
  // días) o un extra.
  principal?: boolean;
  // Cuántas plantas de cada cultivo consume una unidad. Es lo que conecta la venta con el
  // stock, la cámara y los cajones: sin esto, vender un artículo no descuenta nada.
  plantas?: { rucula?: number; lechuga?: number };
  // De qué variedad es esa lechuga. Hace falta porque la cámara y el stock abren lechuga en
  // crespa y hoja de roble, y descontar de la que no es da un stock equivocado en las dos:
  // de menos en la que realmente se consumió y de más en la otra.
  variedadLechuga?: 'crespa' | 'roble';
  legacy?: boolean;     // sigue existiendo por las ventas viejas, no se ofrece nunca
}

export const ARTICULOS: Articulo[] = [
  {
    key: 'rucula', label: 'Rúcula', labelLargo: 'Rúcula',
    xubio: 'RUCULA_HIDROPONICA', unidad: 'unidad', activo: true, principal: true,
    color: '#166534', plantas: { rucula: 1 },
  },
  {
    key: 'lechuga_crespa', label: 'Crespa', labelLargo: 'Lechuga crespa',
    xubio: 'LECHUGA_CRESPA_HIDROPONICA', unidad: 'unidad', activo: true, principal: true,
    color: '#4d7c0f', plantas: { lechuga: 1 },
  },
  {
    key: 'hoja_roble', label: 'Hoja Roble', labelLargo: 'Lechuga hoja de roble',
    xubio: 'LECHUGA_HOJA_DE_ROBLE_VERDE_HIDROPONICA', unidad: 'unidad', activo: true, principal: true,
    color: '#65a30d', plantas: { lechuga: 1 },
  },
  {
    key: 'albahaca', label: 'Albahaca', labelLargo: 'Albahaca',
    xubio: 'ALBAHACA_HIDROPONICA', unidad: 'unidad', activo: true,
    color: '#047857',
  },
  // ── Ensaladas (septiembre 2026) ──
  // Consumo confirmado por Marcos: 2,5 plantas de rúcula y 1 de lechuga.
  //
  // El consumo es fraccionario a propósito y no se redondea: 2,5 es el promedio real, y
  // redondear a 3 infla el descuento de stock un 20% en cada venta. Los totales se redondean
  // recién al mostrarlos.
  //
  // La clásica lleva lechuga CRESPA (confirmado por Marcos): descuenta de crespa en la
  // cámara y en el stock por cultivo.
  {
    key: 'ensalada_rucula_parmesano', label: 'Ens. Rúc/Parm', labelLargo: 'Ensalada de rúcula y parmesano',
    xubio: 'Ensalada Rucula y Parmesano', unidad: 'unidad', activo: true,
    color: '#0f766e', plantas: { rucula: 2.5 },
  },
  {
    key: 'ensalada_clasica', label: 'Ens. Clásica', labelLargo: 'Ensalada clásica',
    xubio: 'Ensalada Clasica', unidad: 'unidad', activo: true,
    color: '#0e7490', plantas: { lechuga: 1 }, variedadLechuga: 'crespa',
  },
  // ── Dado de baja ──
  // No se hace más (Marcos, septiembre 2026). Se mantiene para las ventas ya cargadas.
  {
    key: 'bandeja_rucula', label: 'Bandeja', labelLargo: 'Rúcula en bandeja',
    xubio: 'BANDEJA_RUCULA_HIDROPONICA', unidad: 'unidad', activo: false,
    color: '#14532d', plantas: { rucula: 1 },
  },
  // ── Por kilo ──
  {
    key: 'rucula_kg', label: 'Rúcula kg', labelLargo: 'Rúcula por kg',
    xubio: 'RUCULA_HIDROPONICA_KG', unidad: 'kg', activo: true, color: '#166534',
  },
  {
    key: 'lechuga_kg_crespa', label: 'Crespa kg', labelLargo: 'Lechuga crespa por kg',
    xubio: 'KG Lechuga Crespa', unidad: 'kg', activo: true, color: '#4d7c0f',
  },
  {
    key: 'lechuga_kg_roble', label: 'Roble kg', labelLargo: 'Lechuga hoja de roble por kg',
    xubio: 'KG Lechuga Hoja de Roble', unidad: 'kg', activo: true, color: '#65a30d',
  },
  {
    // Lechuga por kg sin distinguir variedad. Ya no se carga: existe por las ventas
    // anteriores al split crespa/roble.
    key: 'lechuga_kg', label: 'Lechuga kg', labelLargo: 'Lechuga por kg',
    xubio: 'LECHUGA_HIDROPONICA_KG', unidad: 'kg', activo: false, legacy: true, color: '#4d7c0f',
  },
];

const porKey = new Map(ARTICULOS.map((a) => [a.key, a]));
export function articulo(key: string): Articulo | undefined { return porKey.get(key); }

// TODAS las claves que pueden aparecer en una fila de ventas, incluidas las dadas de baja.
// Es la lista que usa todo lo que LEE ventas —estadísticas, facturación, control— porque
// las ventas viejas siguen teniendo esas columnas cargadas.
export const PROD_KEYS = ARTICULOS.map((a) => a.key);

// Las que se ofrecen para cargar hoy. Es la lista que usan los formularios.
export const ARTICULOS_ACTIVOS = ARTICULOS.filter((a) => a.activo);
export const KEYS_ACTIVAS = ARTICULOS_ACTIVOS.map((a) => a.key);

// Por unidad y por kilo se cargan en pantallas distintas y se valorizan distinto.
export const ARTICULOS_UNIDAD = ARTICULOS_ACTIVOS.filter((a) => a.unidad === 'unidad');
export const ARTICULOS_KG = ARTICULOS_ACTIVOS.filter((a) => a.unidad === 'kg');
export const KEYS_UNIDAD = ARTICULOS_UNIDAD.map((a) => a.key);
export const KEYS_KG = ARTICULOS_KG.map((a) => a.key);

// Todas las claves por unidad, incluidas las de baja: lo que lee ventas viejas necesita
// contar la bandeja de rúcula, que se vendió durante años.
export const KEYS_UNIDAD_HISTORICAS = ARTICULOS.filter((a) => a.unidad === 'unidad').map((a) => a.key);

export const LABELS: Record<string, string> = Object.fromEntries(ARTICULOS.map((a) => [a.key, a.label]));
export const LABELS_LARGOS: Record<string, string> = Object.fromEntries(ARTICULOS.map((a) => [a.key, a.labelLargo]));
export const PRODUCTO_XUBIO: Record<string, string> = Object.fromEntries(ARTICULOS.map((a) => [a.key, a.xubio]));

// Cuántas plantas de un cultivo consume una fila de venta. Un artículo sin `plantas` suma
// 0 — es la forma de decir "esto no sale de la cámara".
//
// `variedad` acota a una variedad de lechuga: se usa donde el stock está abierto en crespa
// y hoja de roble. Sin acotar, suma toda la lechuga junta, que es lo que necesitan los
// cajones y el reporte semanal.
export function plantasDeVenta(
  v: any, cultivo: 'rucula' | 'lechuga', variedad?: 'crespa' | 'roble',
): number {
  let total = 0;
  for (const a of ARTICULOS) {
    const por = a.plantas?.[cultivo];
    if (!por) continue;
    // Los artículos que SON la variedad (lechuga_crespa, hoja_roble) se reconocen por su
    // clave; los que la consumen sin serlo —una ensalada— por `variedadLechuga`.
    if (variedad && cultivo === 'lechuga') {
      const suya = a.variedadLechuga
        || (a.key === 'lechuga_crespa' ? 'crespa' : a.key === 'hoja_roble' ? 'roble' : undefined);
      if (suya !== variedad) continue;
    }
    total += (Number(v?.[a.key]) || 0) * por;
  }
  return total;
}
