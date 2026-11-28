// ══ Entregas confirmadas por el reparto ═══════════════════════════════════════════════
//
// El problema que resuelve: hasta ahora la factura salía ANTES de que la mercadería se
// moviera, así que el comprobante decía lo que pensábamos entregar. Cada diferencia
// terminaba en una nota de crédito.
//
// Ahora el que entrega confirma qué dejó, y recién ahí sale la factura. El que no se
// confirma se factura igual a las 16 h con lo que se había cargado: la herramienta no puede
// frenar la facturación del día porque alguien no abrió el celular.
//
// Diseño completo y por qué de cada decisión: docs/validacion-de-entregas.md
//
// ── Por qué las cantidades son una LISTA y no un diccionario por artículo ──
//
// Porque un cliente puede tener varias filas de venta el mismo día, y porque la nota de
// crédito (LineaNC en lib/notaCredito.ts) pide `id_venta` por renglón. Guardado agregado
// por artículo habría que adivinar de qué fila salió cada paquete.
//
// ── Por qué se guarda el pedido original ──
//
// Para poder decir que un pedido fijo quedó viejo. Si el repartidor le deja 8 a Heroica
// tres semanas seguidas cuando le cargamos 18, el problema no es el reparto: es el pedido
// fijo, y eso no se ve si la única cantidad que queda guardada es la que se entregó.

import type { VentaDia, ClienteVenta } from './types';
import { nombreClienteVisible } from './clientes';

export const HOJA_ENTREGAS = 'Entregas';
export const HEADERS_ENTREGAS = [
  'id_entrega', 'fecha', 'id_control', 'sucursal', 'estado',
  'validado_por', 'validado_en', 'lineas', 'cajones_devueltos', 'nota', 'comprobante',
];

// 'validada' = alguien dijo qué se entregó. 'auto' = nadie dijo nada y se facturó a las 16
// con lo cargado. No es lo mismo y no se muestran juntas en ningún lado: "nadie confirmó"
// no es "se entregó tal cual".
export type EstadoEntrega = 'validada' | 'auto';

export interface LineaEntrega {
  // Vacío solo cuando el repartidor agrega algo que no estaba en la lista del día.
  id_venta: string;
  key: string;       // clave de artículo (rucula, lechuga_crespa, …)
  pedido: number;    // lo que se había cargado. NO SE TOCA NUNCA.
  entregado: number;
}

export interface Entrega {
  id_entrega: string;
  fecha: string;          // la de la entrega = la de la venta
  id_control: string;
  sucursal: string;
  estado: EstadoEntrega;
  validado_por: string;
  validado_en: string;
  lineas: LineaEntrega[];
  cajones_devueltos: number;
  nota: string;
  comprobante: string;    // la factura que salió de esta entrega, cuando ya salió
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const soloDia = (v: any) => String(v || '').split(/[T ]/)[0];

// La clave de una entrega. Una por cliente, sucursal y día: el mismo cliente con dos
// sucursales son dos entregas, porque son dos lugares y dos remitos.
export function claveEntrega(fecha: string, idControl: string, sucursal: string): string {
  return [soloDia(fecha), String(idControl), String(sucursal || '')].join('||');
}

export function parseEntrega(row: any): Entrega {
  let lineas: LineaEntrega[] = [];
  try {
    const crudo = JSON.parse(String(row?.lineas || '[]'));
    if (Array.isArray(crudo)) {
      lineas = crudo.map((l: any) => ({
        id_venta: String(l?.id_venta || ''),
        key: String(l?.key || ''),
        pedido: num(l?.pedido),
        entregado: num(l?.entregado),
      })).filter((l) => l.key);
    }
  } catch {
    // Una fila con el JSON roto no puede tumbar la lectura de todas las demás: se devuelve
    // sin líneas, que es visible (la entrega aparece sin detalle) y no silencioso.
  }
  return {
    id_entrega: String(row?.id_entrega || ''),
    fecha: soloDia(row?.fecha),
    id_control: String(row?.id_control || ''),
    sucursal: String(row?.sucursal || ''),
    estado: String(row?.estado) === 'auto' ? 'auto' : 'validada',
    validado_por: String(row?.validado_por || ''),
    validado_en: String(row?.validado_en || ''),
    lineas,
    cajones_devueltos: num(row?.cajones_devueltos),
    nota: String(row?.nota || ''),
    comprobante: String(row?.comprobante || ''),
  };
}

// ── La lista del día del repartidor ──────────────────────────────────────────────────
//
// Se arma de las VENTAS de esa fecha, no de una tabla propia: una venta sin fila en
// Entregas es, por definición, una entrega sin confirmar. Un pre-armado nocturno sería una
// cosa más que se puede desincronizar de la planilla sin que nadie se entere.

export interface EntregaDelDia {
  clave: string;
  fecha: string;
  id_control: string;
  cliente: string;
  sucursal: string;
  lineas: LineaEntrega[];
  // Ya salió la factura de esta entrega. Pasa cuando el admin facturó a mano desde Ventas
  // (el "facturar igual"). Confirmarla sigue sirviendo —queda la diferencia registrada—
  // pero no se reescribe la venta ni se emite nada: lo que ya fue a AFIP no se toca.
  yaFacturada: boolean;
  comprobante: string;
  estado: 'sin_confirmar' | EstadoEntrega;
  validado_por: string;
  validado_en: string;
  cajones_devueltos: number;
}

export function entregasDelDia(
  ventas: VentaDia[],
  clientes: ClienteVenta[],
  entregas: Entrega[],
  fecha: string,
  claves: string[],
): EntregaDelDia[] {
  const dia = soloDia(fecha);
  const porCliente = new Map(clientes.map((c) => [String(c.id_control), c]));
  const porClave = new Map(entregas.map((e) => [claveEntrega(e.fecha, e.id_control, e.sucursal), e]));

  const grupos = new Map<string, EntregaDelDia>();
  for (const v of ventas) {
    if (soloDia(v.fecha) !== dia) continue;
    const clave = claveEntrega(dia, String(v.id_control), String(v.sucursal || ''));
    // Lo que ya tiene comprobante salió a AFIP; 'PENDIENTE' es la cola, no un comprobante.
    const exportado = String(v.exportado || '').trim();
    const facturada = !!exportado && exportado !== 'PENDIENTE';
    if (!grupos.has(clave)) {
      const c = porCliente.get(String(v.id_control));
      const ya = porClave.get(clave);
      grupos.set(clave, {
        clave,
        fecha: dia,
        id_control: String(v.id_control),
        cliente: c ? nombreClienteVisible(c) : String(v.nombre_cliente || v.id_control),
        sucursal: String(v.sucursal || ''),
        lineas: [],
        yaFacturada: false,
        comprobante: '',
        estado: ya ? ya.estado : 'sin_confirmar',
        validado_por: ya?.validado_por || '',
        validado_en: ya?.validado_en || '',
        cajones_devueltos: ya?.cajones_devueltos || 0,
      });
    }
    const g = grupos.get(clave)!;
    if (facturada) { g.yaFacturada = true; g.comprobante = exportado; }
    for (const k of claves) {
      const cant = num((v as any)[k]);
      if (cant <= 0) continue;
      g.lineas.push({ id_venta: String(v.id_venta), key: k, pedido: cant, entregado: cant });
    }
  }

  // Lo ya confirmado manda: si hay entrega, las cantidades que se muestran son las que dijo
  // el repartidor, no las de la planilla. Las líneas que él agregó (sin id_venta) también
  // tienen que aparecer, o al volver a entrar parecería que no se guardaron.
  for (const g of grupos.values()) {
    const e = porClave.get(g.clave);
    if (!e) continue;
    const porLinea = new Map(e.lineas.map((l) => [`${l.id_venta}||${l.key}`, l]));
    for (const l of g.lineas) {
      const guardada = porLinea.get(`${l.id_venta}||${l.key}`);
      if (guardada) { l.entregado = guardada.entregado; porLinea.delete(`${l.id_venta}||${l.key}`); }
    }
    for (const sobrante of porLinea.values()) g.lineas.push({ ...sobrante });
  }

  // Sin cantidades no es una entrega: es una fila de la planilla que quedó en cero.
  return [...grupos.values()]
    .filter((g) => g.lineas.length > 0)
    .sort((a, b) => a.cliente.localeCompare(b.cliente) || a.sucursal.localeCompare(b.sucursal));
}

// ── Diferencias ──────────────────────────────────────────────────────────────────────

export interface Diferencia {
  key: string;
  id_venta: string;
  pedido: number;
  entregado: number;
  delta: number;   // negativo = entregó menos
}

export function diferenciasDe(lineas: LineaEntrega[]): Diferencia[] {
  return lineas
    .map((l) => ({ key: l.key, id_venta: l.id_venta, pedido: l.pedido, entregado: l.entregado, delta: l.entregado - l.pedido }))
    .filter((d) => d.delta !== 0);
}

export function tieneDiferencia(e: Entrega): boolean {
  return diferenciasDe(e.lineas).length > 0;
}

// ── El pedido fijo que quedó viejo ───────────────────────────────────────────────────
//
// Es la parte que convierte el mail en algo que se acciona. Un cliente que recibe menos de
// lo que le cargamos una vez tuvo un mal día; uno que recibe menos tres de cada cuatro
// veces tiene el pedido fijo mal, y eso se arregla una vez y no vuelve a aparecer.
//
// 3 de las últimas 4 y no 2: con 2 de 4 entra cualquier cliente que haya tenido una semana
// floja, y una lista de la que la mitad es ruido se deja de leer.
export const ENTREGAS_PARA_PATRON = 4;
export const MINIMO_PARA_PATRON = 3;

export interface PatronPedidoViejo {
  id_control: string;
  sucursal: string;
  key: string;
  veces: number;        // en cuántas de las últimas entregas entregó menos
  de: number;           // sobre cuántas
  promedioEntregado: number;
  promedioPedido: number;
}

export function patronesPedidoViejo(entregas: Entrega[]): PatronPedidoViejo[] {
  // Solo las validadas: una 'auto' no dice nada sobre lo que se entregó.
  const validadas = entregas.filter((e) => e.estado === 'validada');
  const porClienteArticulo = new Map<string, { fecha: string; pedido: number; entregado: number }[]>();
  for (const e of validadas) {
    // Varias filas del mismo artículo en la misma entrega son un solo dato del día.
    const porKey = new Map<string, { pedido: number; entregado: number }>();
    for (const l of e.lineas) {
      const acc = porKey.get(l.key) || { pedido: 0, entregado: 0 };
      acc.pedido += l.pedido; acc.entregado += l.entregado;
      porKey.set(l.key, acc);
    }
    for (const [key, v] of porKey) {
      const clave = `${e.id_control}||${e.sucursal}||${key}`;
      if (!porClienteArticulo.has(clave)) porClienteArticulo.set(clave, []);
      porClienteArticulo.get(clave)!.push({ fecha: e.fecha, ...v });
    }
  }

  const out: PatronPedidoViejo[] = [];
  for (const [clave, lista] of porClienteArticulo) {
    const ultimas = lista.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, ENTREGAS_PARA_PATRON);
    if (ultimas.length < MINIMO_PARA_PATRON) continue;
    const menos = ultimas.filter((x) => x.entregado < x.pedido).length;
    if (menos < MINIMO_PARA_PATRON) continue;
    const [id_control, sucursal, key] = clave.split('||');
    out.push({
      id_control, sucursal, key,
      veces: menos,
      de: ultimas.length,
      promedioEntregado: Math.round((ultimas.reduce((a, x) => a + x.entregado, 0) / ultimas.length) * 10) / 10,
      promedioPedido: Math.round((ultimas.reduce((a, x) => a + x.pedido, 0) / ultimas.length) * 10) / 10,
    });
  }
  return out.sort((a, b) => (b.promedioPedido - b.promedioEntregado) - (a.promedioPedido - a.promedioEntregado));
}

// ── Las ventas que hay que facturar igual ────────────────────────────────────────────
//
// A las 16 h: todo lo que se cargó y nadie confirmó. Se factura con lo que se cargó, que es
// exactamente lo que pasaba antes de que esto existiera. La herramienta no puede frenar la
// facturación del día porque alguien no abrió el celular.
export function sinConfirmarAlCierre(
  ventas: VentaDia[], entregas: Entrega[], fecha: string,
): { id_control: string; sucursal: string; fecha: string }[] {
  const dia = soloDia(fecha);
  const confirmadas = new Set(entregas.map((e) => claveEntrega(e.fecha, e.id_control, e.sucursal)));
  const out = new Map<string, { id_control: string; sucursal: string; fecha: string }>();
  for (const v of ventas) {
    if (soloDia(v.fecha) !== dia) continue;
    if (String(v.exportado || '').trim()) continue;  // ya facturada o ya en la cola
    const clave = claveEntrega(dia, String(v.id_control), String(v.sucursal || ''));
    if (confirmadas.has(clave)) continue;
    if (!out.has(clave)) out.set(clave, { id_control: String(v.id_control), sucursal: String(v.sucursal || ''), fecha: dia });
  }
  return [...out.values()];
}

export function nuevoIdEntrega(fecha: string): string {
  return `ENT-${soloDia(fecha).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
