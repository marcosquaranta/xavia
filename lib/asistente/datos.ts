import { readSheet } from '../sheets';
import type {
  Articulo, StockMes, Gasto, VentaDia, PrecioVenta, ClienteVenta, Lote, Movimiento, Ubicacion,
} from '../types';

// ── Las planillas, leídas una sola vez por consulta ───────────────────────────────────
//
// El asistente puede llamar varias herramientas para contestar una sola pregunta ("¿cuánto
// stock de cubos tengo y cuánto gastamos en insumos?"), y cada planilla tarda lo suyo en
// leerse. Sin esto, cada herramienta releería las mismas hojas: la respuesta pasaría de dos
// segundos a diez, y con varias personas preguntando a la vez se come la cuota de Sheets.
//
// Vive por consulta y no en un módulo global a propósito: un caché que sobrevive entre
// pedidos contestaría con datos viejos sin forma de saber de cuándo son, que en una pantalla
// de plata es peor que tardar.

export class Planillas {
  private cache = new Map<string, Promise<any[]>>();

  private leer<T>(hoja: string): Promise<T[]> {
    if (!this.cache.has(hoja)) {
      this.cache.set(hoja, readSheet<T>(hoja).catch(() => [] as T[]) as Promise<any[]>);
    }
    return this.cache.get(hoja)! as Promise<T[]>;
  }

  articulos() { return this.leer<Articulo>('Articulos'); }
  stocks() { return this.leer<StockMes>('Stocks'); }
  gastos() { return this.leer<Gasto>('Gastos'); }
  ventas() { return this.leer<VentaDia>('Ventas'); }
  precios() { return this.leer<PrecioVenta>('Precios'); }
  clientes() { return this.leer<ClienteVenta>('Clientes'); }
  lotes() { return this.leer<Lote>('Lotes'); }
  movimientos() { return this.leer<Movimiento>('Movimientos'); }
  ubicaciones() { return this.leer<Ubicacion>('Ubicaciones'); }
  config() { return this.leer<{ clave: string; valor: any }>('Configuracion'); }
  hoja<T>(nombre: string) { return this.leer<T>(nombre); }
}
