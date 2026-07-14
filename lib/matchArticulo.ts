import type { Articulo } from './types';

export function normalizarTexto(s: string): string {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function matchArticuloPorTexto(texto: string, articulos: Articulo[]): Articulo | null {
  const n = normalizarTexto(texto);
  if (!n) return null;
  return articulos.find((a) => normalizarTexto(a.articulo) === n)
    || articulos.find((a) => normalizarTexto(a.articulo).includes(n) || n.includes(normalizarTexto(a.articulo)))
    || null;
}
