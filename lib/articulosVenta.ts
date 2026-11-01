// ══ Artículos de venta que se dan de alta desde la app ════════════════════════════════
//
// El catálogo vive en lib/articulos.ts, escrito en el código, y eso estuvo bien mientras
// fueron ocho productos que casi no cambiaban. Dejó de estarlo cuando aparecieron los
// microgreens: tres tamaños de bandeja por cuatro o cinco variedades, con el portfolio
// todavía moviéndose. Cada alta era un deploy, y entre que se decidía vender algo y se podía
// cargar la venta había alguien esperando.
//
// Así que el catálogo ahora es: lo que está en el código MÁS lo que esté en esta hoja. Una
// sola lista, armada en un solo lugar (`catalogoCon`), para no volver al problema que
// lib/articulos.ts vino a resolver.
//
// ── El límite, y por qué es estructural ──────────────────────────────────────────────
//
// Un artículo de esta hoja NO puede declarar `plantas`. Ese campo es el que conecta una
// venta con la cámara y el stock de plantas —una ensalada se lleva 2,5 plantas de rúcula— y
// decidirlo mal no da un error: da un stock de cámara equivocado durante semanas, de menos
// en un cultivo y de más en otro, sin que nada avise.
//
// Eso no es un dato que se carga, es una decisión de modelo. Los artículos de la hoja son
// productos que se venden y se facturan pero que no consumen plantas del circuito: los
// microgreens en bandeja son exactamente eso. Como `plantas` no se puede setear desde acá,
// `plantasDeVenta()` sigue siendo correcta sin conocer los extras, y no hay forma de romper
// la cámara desde una pantalla de alta.

import type { Articulo, UnidadArticulo } from './articulos';
import { ARTICULOS } from './articulos';
import { readSheet } from './sheets';

export const HOJA_ARTICULOS_VENTA = 'ArticulosVenta';

export const HEADERS_ARTICULOS_VENTA = [
  'key', 'label', 'label_largo', 'xubio', 'unidad', 'activo', 'color', 'seccion_aparte', 'orden', 'notas',
  'usuario', 'fecha_alta',
];

export interface FilaArticuloVenta {
  key: string;
  label: string;
  label_largo: string;
  xubio: string;
  unidad: string;
  activo: string;
  color: string;
  seccion_aparte: string;
  orden: number | string;
  notas: string;
  usuario: string;
  fecha_alta: string;
}

// Columnas que ya significan otra cosa en Ventas o en Precios. Una clave que pise una de
// estas no da un error: escribe encima de la fecha, del cliente o del flag de exportado, y
// se descubre cuando una venta aparece con la fecha en blanco.
const RESERVADAS = new Set([
  'id_venta', 'fecha', 'id_control', 'nombre_cliente', 'sucursal', 'sucursal_obs',
  'exportado', 'usuario', 'fecha_carga', 'id_pedido_fijo', 'dia_semana', 'notas',
  'id_articulo', 'activo', 'key', 'label', 'unidad', 'color', 'orden', 'xubio',
]);

// La clave es el nombre de la COLUMNA en las planillas de Ventas y Precios, así que una vez
// creada no se puede cambiar sin dejar huérfanas las ventas ya cargadas. Por eso se valida
// fuerte al crear y después queda fija.
export function validarClave(key: string): string | null {
  const k = String(key || '').trim();
  if (!k) return 'Poné una clave para el artículo.';
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(k)) {
    return 'La clave va en minúsculas, sin espacios ni acentos, separando con guión bajo (ej: bandeja_microgreen_105). Entre 2 y 40 caracteres.';
  }
  if (RESERVADAS.has(k)) return `"${k}" es el nombre de una columna que ya usa la planilla para otra cosa. Elegí otra.`;
  if (ARTICULOS.some((a) => a.key === k)) return `Ya existe un artículo con la clave "${k}".`;
  return null;
}

const esSi = (v: any) => String(v ?? '').trim().toUpperCase() !== 'NO';

// Una fila de la hoja convertida en Articulo. Devuelve null si no se puede usar: una fila a
// medio cargar es mejor ignorarla que meterla al catálogo con el nombre de Xubio vacío, que
// es la forma de que la venta se cargue bien y la factura salga sin ese ítem.
function filaAArticulo(f: FilaArticuloVenta): Articulo | null {
  const key = String(f.key || '').trim();
  if (!key || !/^[a-z][a-z0-9_]{1,39}$/.test(key) || RESERVADAS.has(key)) return null;
  const xubio = String(f.xubio || '').trim();
  if (!xubio) return null;
  const label = String(f.label || '').trim() || key;
  const unidad: UnidadArticulo = String(f.unidad || '').trim().toLowerCase() === 'kg' ? 'kg' : 'unidad';
  return {
    key,
    label,
    labelLargo: String(f.label_largo || '').trim() || label,
    xubio,
    unidad,
    activo: esSi(f.activo),
    color: /^#[0-9a-fA-F]{6}$/.test(String(f.color || '').trim()) ? String(f.color).trim() : '#0f766e',
    // Los de alta propia van en su sección aparte de la grilla, igual que las ensaladas: la
    // grilla principal ya es ancha y sumarle columnas que compran dos clientes la vuelve
    // ilegible para los veinte que no los compran.
    seccionAparte: esSi(f.seccion_aparte),
    // `plantas` nunca se setea acá, a propósito. Ver el comentario de arriba.
  } as Articulo;
}

export async function leerArticulosExtra(): Promise<Articulo[]> {
  const filas = await readSheet<FilaArticuloVenta>(HOJA_ARTICULOS_VENTA).catch(() => [] as FilaArticuloVenta[]);
  const vistos = new Set(ARTICULOS.map((a) => a.key));
  const out: Articulo[] = [];
  for (const f of filas.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))) {
    const art = filaAArticulo(f);
    // Una clave repetida (en el código o dentro de la misma hoja) se ignora en vez de pisar:
    // dos artículos con la misma columna escriben uno encima del otro.
    if (!art || vistos.has(art.key)) continue;
    vistos.add(art.key);
    out.push(art);
  }
  return out;
}

// ── El catálogo completo ──────────────────────────────────────────────────────────────
//
// Es LA función. Cualquier pantalla que necesite la lista de lo que se vende sale de acá, así
// no vuelve a haber dos listas que se contradigan.
export interface CatalogoVenta {
  todos: Articulo[];
  activos: Articulo[];
  unidad: Articulo[];       // activos que se venden por unidad
  kg: Articulo[];           // activos que se venden por kilo
  keys: string[];           // TODAS las claves, incluidas las dadas de baja: es la lista que
                            // usa lo que lee ventas viejas (estadísticas, facturación, EERR)
  keysUnidad: string[];
  xubio: Record<string, string>;
  labels: Record<string, string>;
}

export function catalogoCon(extras: Articulo[] = []): CatalogoVenta {
  const todos = [...ARTICULOS, ...extras];
  const activos = todos.filter((a) => a.activo);
  return {
    todos,
    activos,
    unidad: activos.filter((a) => a.unidad === 'unidad'),
    kg: activos.filter((a) => a.unidad === 'kg'),
    keys: todos.map((a) => a.key),
    keysUnidad: todos.filter((a) => a.unidad === 'unidad').map((a) => a.key),
    xubio: Object.fromEntries(todos.map((a) => [a.key, a.xubio])),
    labels: Object.fromEntries(todos.map((a) => [a.key, a.labelLargo])),
  };
}

// Atajo para el camino más común: leer la hoja y devolver el catálogo ya armado.
export async function catalogoDeVenta(): Promise<CatalogoVenta> {
  return catalogoCon(await leerArticulosExtra());
}
