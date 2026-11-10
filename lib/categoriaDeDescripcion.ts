// ── Adivinar la categoría de un gasto por su descripción ─────────────────────────────
//
// Dos caminos, y el orden importa: primero lo que ya se cargó antes, y solo si eso no
// alcanza, la IA.
//
// Lo que ya se cargó es gratis, instantáneo y siempre da lo mismo. "Autónomos" se cargó
// doce veces como Impuestos: no hace falta preguntarle nada a nadie. Además aprende solo de
// cómo clasifica Marcos, que es más confiable que cualquier regla general — si él pone los
// peajes en Mantenimiento, el matcheo por historia lo respeta y la IA no.
//
// La IA es para lo que nunca se cargó. Eso es una minoría de los gastos, así que el costo
// es despreciable, y es exactamente donde el historial no tiene nada que decir.

import { CATEGORIAS_GASTO } from './types';

const norm = (s: any) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export interface GastoPrevio { descripcion: string; categoria: string }

// La categoría con la que se cargó antes esta misma descripción. La MÁS USADA, no la
// última: una vez mal cargada no tiene que pisar a las diez veces que se cargó bien.
export function categoriaPorHistoria(descripcion: string, previos: GastoPrevio[]): string | null {
  const k = norm(descripcion);
  if (k.length < 3) return null;

  const cuenta = new Map<string, number>();
  for (const g of previos || []) {
    if (norm(g.descripcion) !== k) continue;
    const c = String(g.categoria || '').trim();
    if (!c || !CATEGORIAS_GASTO.some((x) => x.value === c)) continue;
    cuenta.set(c, (cuenta.get(c) || 0) + 1);
  }
  if (!cuenta.size) return null;
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// Si no hay match exacto, el de una descripción que CONTENGA a esta (o al revés). Es lo que
// hace que "Nafta YPF ruta 9" encuentre a "Nafta YPF". Pide cinco letras para no empezar a
// matchear por "de" o "pago".
export function categoriaPorParecido(descripcion: string, previos: GastoPrevio[]): string | null {
  const k = norm(descripcion);
  if (k.length < 5) return null;

  const cuenta = new Map<string, number>();
  for (const g of previos || []) {
    const n = norm(g.descripcion);
    if (n.length < 5) continue;
    if (!(n.includes(k) || k.includes(n))) continue;
    const c = String(g.categoria || '').trim();
    if (!c || !CATEGORIAS_GASTO.some((x) => x.value === c)) continue;
    cuenta.set(c, (cuenta.get(c) || 0) + 1);
  }
  if (!cuenta.size) return null;
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// El camino completo del lado del navegador: exacto, después parecido. Null = hay que
// preguntarle a la IA.
export function categoriaLocal(descripcion: string, previos: GastoPrevio[]): string | null {
  return categoriaPorHistoria(descripcion, previos) ?? categoriaPorParecido(descripcion, previos);
}
