// ── Caché local de comprobantes y cobranzas de Xubio ─────────────────────────────────
//
// Xubio devuelve como máximo 100 resultados por consulta, así que pedirle un año se
// resuelve partiendo el rango por la mitad una y otra vez hasta que cada pedazo entre en
// 100 (ver comprobantesEnRango en lib/xubio.ts). Son decenas de llamadas encadenadas: por
// eso abrir Cobranzas, o elegir un cliente para marcarle facturas, tardaba una eternidad.
//
// Es el mismo problema que ya tenía CrossChex y se resuelve igual (ver lib/fichajesCache):
// un cron le habla a Xubio una vez por día y guarda acá lo que trajo; las pantallas leen
// esta hoja, que es una lectura de Sheets normal.
//
// ── Por qué no alcanza con lo que la app ya sabe ──
//
// Tentador: la app registra sus propias ventas y sus propios cobros, ¿para qué ir a Xubio?
// Porque lo que NO pasó por la app es justamente lo que importa acá. Las facturas cargadas
// a mano en Xubio no existen del lado de la app, y —sobre todo— los cobros cargados allá
// son los que permiten dar por cubiertas las facturas viejas. Sin eso, todo cliente con
// historia aparece debiendo cientos de facturas que en realidad pagó, que es exactamente el
// estado del que se salió hace unos días.
//
// Se guarda lo mínimo que usan las pantallas, no el bean entero: el resto es ruido que
// engorda la planilla y hace más lenta justamente la lectura que se quiere rápida.

import { asegurarHoja, readSheet, appendRowsObj, batchUpdateRows } from './sheets';
import { getComprobantes, getCobranzas, importeCobranza } from './xubio';
import { nombreClienteComprobante } from './recordatoriosCobro';

export const HOJA_COMPROBANTES = 'XubioComprobantes';
export const HEADERS_COMPROBANTES = ['transaccionid', 'fecha', 'cliente', 'tipo', 'numero', 'importe', 'actualizado'];

export const HOJA_COBRANZAS_CACHE = 'XubioCobranzas';
export const HEADERS_COBRANZAS_CACHE = ['transaccionid', 'fecha', 'cliente', 'importe', 'actualizado'];

export interface ComprobanteCache {
  transaccionid: string | number;
  fecha: string;
  cliente: string;
  tipo: number | string;
  numero: string;
  importe: number | string;
  actualizado: string;
}

export interface CobranzaCache {
  transaccionid: string | number;
  fecha: string;
  cliente: string;
  importe: number | string;
  actualizado: string;
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

// Vuelve a darle a lo cacheado la forma que devuelve la API, para que todo lo que ya
// trabaja sobre comprobantes de Xubio —facturasPorCliente, calcularSaldos, compararFacturado—
// siga funcionando sin tocarse. Si mañana hace falta un campo más, se agrega a la hoja; lo
// que no se quiere es dos formas distintas del mismo dato dando vueltas por el código.
export function comprobantesDesdeCache(filas: ComprobanteCache[], desde: string, hasta: string): any[] {
  return (filas || [])
    .filter((f) => {
      const d = soloFecha(f.fecha);
      return !!d && d >= desde && d <= hasta;
    })
    .map((f) => ({
      transaccionid: Number(f.transaccionid) || 0,
      fecha: soloFecha(f.fecha),
      cliente: { nombre: String(f.cliente || '') },
      tipo: Number(f.tipo) || 1,
      numeroDocumento: String(f.numero || ''),
      importetotal: Number(f.importe) || 0,
    }));
}

export function cobranzasDesdeCache(filas: CobranzaCache[], desde: string, hasta: string): any[] {
  return (filas || [])
    .filter((f) => {
      const d = soloFecha(f.fecha);
      return !!d && d >= desde && d <= hasta;
    })
    .map((f) => ({
      transaccionid: Number(f.transaccionid) || 0,
      fecha: soloFecha(f.fecha),
      cliente: { nombre: String(f.cliente || '') },
      // El importe ya viene sumado de los instrumentos de cobro. Se devuelve con la misma
      // forma que la API para que importeCobranza() siga dando lo mismo sobre el caché.
      transaccionInstrumentoDeCobro: [{ importe: Number(f.importe) || 0 }],
    }));
}

export async function leerComprobantesCache(desde: string, hasta: string): Promise<any[]> {
  const filas = await readSheet<ComprobanteCache>(HOJA_COMPROBANTES).catch(() => []);
  return comprobantesDesdeCache(filas, desde, hasta);
}

export async function leerCobranzasCache(desde: string, hasta: string): Promise<any[]> {
  const filas = await readSheet<CobranzaCache>(HOJA_COBRANZAS_CACHE).catch(() => []);
  return cobranzasDesdeCache(filas, desde, hasta);
}

export interface ResultadoSnapshot {
  comprobantes: { nuevos: number; actualizados: number; total: number };
  cobranzas: { nuevos: number; actualizados: number; total: number };
}

// Trae de Xubio un rango y lo guarda. Se vuelve a traer una ventana que ya se había traído
// —no solo lo nuevo— porque un comprobante se puede anular o corregir después de emitido, y
// una caché que solo crece se queda con la versión vieja para siempre.
export async function guardarSnapshotXubio(desde: string, hasta: string): Promise<ResultadoSnapshot> {
  await asegurarHoja(HOJA_COMPROBANTES, HEADERS_COMPROBANTES);
  await asegurarHoja(HOJA_COBRANZAS_CACHE, HEADERS_COBRANZAS_CACHE);
  const ahora = new Date().toISOString();

  const [comps, cobs, filasComp, filasCob] = await Promise.all([
    getComprobantes(desde, hasta),
    getCobranzas(desde, hasta).catch(() => [] as any[]),
    readSheet<ComprobanteCache>(HOJA_COMPROBANTES).catch(() => []),
    readSheet<CobranzaCache>(HOJA_COBRANZAS_CACHE).catch(() => []),
  ]);

  const res: ResultadoSnapshot = {
    comprobantes: { nuevos: 0, actualizados: 0, total: comps.length },
    cobranzas: { nuevos: 0, actualizados: 0, total: cobs.length },
  };

  const yaComp = new Set(filasComp.map((f) => String(f.transaccionid)));
  const nuevosComp: Record<string, any>[] = [];
  const updComp: { keyValue: string; updates: Record<string, any> }[] = [];
  for (const c of comps) {
    const id = String(c?.transaccionid || '');
    if (!id) continue;
    const fila = {
      transaccionid: id,
      fecha: soloFecha(c?.fecha),
      cliente: nombreClienteComprobante(c),
      tipo: Number(c?.tipo) || 1,
      numero: String(c?.numeroDocumento || '').trim(),
      importe: Number(c?.importetotal) || 0,
      actualizado: ahora,
    };
    if (yaComp.has(id)) { updComp.push({ keyValue: id, updates: fila }); res.comprobantes.actualizados++; }
    else { nuevosComp.push(fila); yaComp.add(id); res.comprobantes.nuevos++; }
  }

  const yaCob = new Set(filasCob.map((f) => String(f.transaccionid)));
  const nuevosCob: Record<string, any>[] = [];
  const updCob: { keyValue: string; updates: Record<string, any> }[] = [];
  for (const c of cobs) {
    const id = String(c?.transaccionid || '');
    if (!id) continue;
    const fila = {
      transaccionid: id,
      fecha: soloFecha(c?.fecha),
      cliente: nombreClienteComprobante(c),
      importe: importeCobranza(c),
      actualizado: ahora,
    };
    if (yaCob.has(id)) { updCob.push({ keyValue: id, updates: fila }); res.cobranzas.actualizados++; }
    else { nuevosCob.push(fila); yaCob.add(id); res.cobranzas.nuevos++; }
  }

  // En lote y no de a una fila: son cientos de filas y Sheets corta por cuota por minuto.
  if (nuevosComp.length) await appendRowsObj(HOJA_COMPROBANTES, nuevosComp);
  if (updComp.length) await batchUpdateRows(HOJA_COMPROBANTES, 'transaccionid', updComp);
  if (nuevosCob.length) await appendRowsObj(HOJA_COBRANZAS_CACHE, nuevosCob);
  if (updCob.length) await batchUpdateRows(HOJA_COBRANZAS_CACHE, 'transaccionid', updCob);

  return res;
}
