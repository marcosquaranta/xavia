// Lectura de la hoja de historial de precios. Va aparte de lib/preciosHistorico.ts porque
// ese archivo es puro a propósito (lo tocan componentes de cliente) y acá entra googleapis.
import { readSheet } from './sheets';
import { fechaArgentinaHoy } from './ocupacion';
import { HOJA_PRECIOS_HIST, ultimaSubaPorCliente, type CambioPrecio } from './preciosHistorico';

// Última suba por cliente, ya serializable para pasarle a un componente de cliente.
// Si la hoja todavía no existe devuelve {}: es lo que va a pasar hasta el primer aumento
// cargado con el historial andando, y la pantalla lo aclara en vez de inventar un número.
export async function ultimaSubaPorClienteRecord(): Promise<Record<string, { fecha: string; diasDesde: number }>> {
  try {
    const hist = await readSheet<CambioPrecio>(HOJA_PRECIOS_HIST);
    const mapa = ultimaSubaPorCliente(hist, fechaArgentinaHoy());
    const out: Record<string, { fecha: string; diasDesde: number }> = {};
    for (const [id, v] of mapa) out[id] = { fecha: v.fecha, diasDesde: v.diasDesde };
    return out;
  } catch {
    return {};
  }
}
