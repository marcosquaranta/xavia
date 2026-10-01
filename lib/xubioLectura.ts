import { leerComprobantesCache, leerCobranzasCache } from './xubioCache';
import { getComprobantes, getCobranzas } from './xubio';

// Comprobantes y cobranzas para MIRAR (no para facturar): salen de la caché local que llena
// el cron diario, y solo se le pide a Xubio si la caché está vacía.
//
// El respaldo existe para el único caso en que importa: el día que se estrena esto, antes de
// que el cron corra por primera vez. Sin él la pantalla aparecería vacía y parecería que se
// perdieron las facturas. Una vez que la caché tiene datos no se consulta más a Xubio desde
// las pantallas, que es todo el punto: Xubio corta en 100 resultados por consulta y un año
// se resuelve con decenas de llamadas encadenadas.
//
// OJO: esto es para leer. Emitir una factura o registrar un cobro le sigue hablando a Xubio
// directo, y tiene que seguir siendo así — ahí lo que importa es el estado real de este
// instante, no una foto de esta mañana.
export async function comprobantesParaMirar(desde: string, hasta: string): Promise<any[]> {
  const cache = await leerComprobantesCache(desde, hasta).catch(() => [] as any[]);
  if (cache.length) return cache;
  return getComprobantes(desde, hasta).catch(() => [] as any[]);
}

export async function cobranzasParaMirar(desde: string, hasta: string): Promise<any[]> {
  const cache = await leerCobranzasCache(desde, hasta).catch(() => [] as any[]);
  if (cache.length) return cache;
  return getCobranzas(desde, hasta).catch(() => [] as any[]);
}
