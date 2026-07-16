import type { Articulo, StockMes } from './types';

function num(v: any) { const n = Number(v); return isNaN(n) ? 0 : n; }

// Último precio de compra conocido de un artículo, al mes indicado o antes.
export function precioUltimoConocido(stocks: StockMes[], id_articulo: string, anio: number, mes: number): number | null {
  const claveActual = anio * 12 + mes;
  const candidatos = stocks.filter((s) =>
    s.id_articulo === id_articulo && num(s.precio_unitario) > 0 && (Number(s.anio) * 12 + Number(s.mes)) <= claveActual
  );
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => (Number(a.anio) * 12 + Number(a.mes)) - (Number(b.anio) * 12 + Number(b.mes)));
  return num(candidatos[candidatos.length - 1].precio_unitario);
}

export interface ValorizacionMes {
  total: number;
  porCategoria: { categoria: string; valorizado: number }[];
}

// Valorización del stock final de un mes puntual, usando el último precio de compra
// conocido de cada artículo (mismo criterio que Stocks). Solo usa datos ya guardados.
export function calcularValorizacionMes(articulos: Articulo[], stocks: StockMes[], anio: number, mes: number): ValorizacionMes {
  const activos = articulos.filter((a) => a.activo === 'SI');
  const porArticulo = activos.map((art) => {
    const s = stocks.find((st) => st.id_articulo === art.id_articulo && String(st.anio) === String(anio) && String(st.mes) === String(mes));
    const stockFinal = s ? num(s.stock_final) : 0;
    const precio = precioUltimoConocido(stocks, art.id_articulo, anio, mes);
    const valorizado = precio !== null ? stockFinal * precio : null;
    return { articulo: art, valorizado };
  });
  const total = porArticulo.reduce((acc, r) => acc + (r.valorizado ?? 0), 0);
  const porCategoria = Array.from(new Set(activos.map((a) => a.categoria)))
    .map((cat) => ({ categoria: cat, valorizado: porArticulo.filter((r) => r.articulo.categoria === cat).reduce((acc, r) => acc + (r.valorizado ?? 0), 0) }))
    .filter((c) => c.valorizado > 0)
    .sort((a, b) => b.valorizado - a.valorizado);
  return { total, porCategoria };
}
