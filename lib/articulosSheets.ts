import { asegurarColumnas } from './sheets';
import { PROD_KEYS, KEYS_UNIDAD_HISTORICAS } from './articulos';

// Qué hoja lleva qué columnas de artículo.
const HOJAS: [string, string[]][] = [
  ['Ventas', PROD_KEYS],
  ['Precios', PROD_KEYS],
  ['PedidosFijos', KEYS_UNIDAD_HISTORICAS],
];

// appendRowObj escribe POR NOMBRE DE COLUMNA y descarta en silencio lo que no encuentra en
// el header: sin esto, un artículo nuevo se guardaba "bien" y no quedaba en ningún lado.
//
// Son tres llamadas —una por hoja— y ninguna escritura cuando las columnas ya están, que es
// el caso normal. La primera versión llamaba a asegurarColumna por cada columna de cada
// hoja: treinta y tres lecturas seguidas, y Google cortaba por cuota por minuto justo al
// guardar una venta.
//
// La promesa se cachea por proceso para no repetirlo en cada guardado. En serverless cada
// instancia nueva lo rehace una vez, que con tres llamadas es barato.
let listo: Promise<void> | null = null;

export function asegurarColumnasArticulos(): Promise<void> {
  if (!listo) {
    listo = (async () => {
      for (const [hoja, claves] of HOJAS) {
        // Que falle no puede impedir guardar: si las columnas ya existían —el caso normal—
        // no cambia nada, y si faltaban el valor se pierde igual que antes.
        await asegurarColumnas(hoja, claves).catch((e) => {
          console.error(`[articulos] no se pudieron asegurar las columnas de ${hoja}:`, e?.message || e);
        });
      }
    })();
    // Si falla, que el próximo intento lo vuelva a probar en vez de quedar cacheado en un
    // estado roto para toda la vida del proceso.
    listo.catch(() => { listo = null; });
  }
  return listo;
}
