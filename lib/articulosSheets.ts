import { asegurarColumna } from './sheets';
import { PROD_KEYS, KEYS_UNIDAD_HISTORICAS } from './articulos';

// Qué hoja lleva qué columnas de artículo.
const HOJAS: [string, string[]][] = [
  ['Ventas', PROD_KEYS],
  ['Precios', PROD_KEYS],
  ['PedidosFijos', KEYS_UNIDAD_HISTORICAS],
];

// Se hace una sola vez por proceso. Son tres lecturas de header y, cuando ya están todas
// las columnas, ninguna escritura: repetirlo en cada guardado sería pagar esas lecturas en
// cada carga de ventas sin que cambie nada.
let listo: Promise<void> | null = null;

export function asegurarColumnasArticulos(): Promise<void> {
  if (!listo) {
    listo = (async () => {
      for (const [hoja, claves] of HOJAS) {
        for (const k of claves) {
          // De a una y en serie: crear dos columnas a la vez las manda a la misma letra.
          await asegurarColumna(hoja, k).catch((e) => {
            // Que falle esto no puede impedir guardar: si la columna ya existía —el caso
            // normal— no cambia nada, y si no existía el valor se pierde igual que antes.
            console.error(`[articulos] no se pudo asegurar ${hoja}.${k}:`, e?.message || e);
          });
        }
      }
    })();
  }
  return listo;
}
