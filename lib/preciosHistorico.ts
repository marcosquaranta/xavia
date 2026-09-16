// ── Historial de precios ──────────────────────────────────────────────────────────────
//
// La hoja Precios guarda SOLO el precio vigente: cuando se edita, el anterior se pierde.
// Por eso no se podía responder "¿hace cuánto que no le subimos a este cliente?", que es
// justo la pregunta que importa al negociar.
//
// Acá se anota cada cambio con el valor viejo y el nuevo. Se empieza a llenar desde que
// esto existe (sept-2026): para atrás no hay nada que recuperar, y la pantalla lo dice en
// vez de mostrar un "hace 0 días" que sería mentira.

export const HOJA_PRECIOS_HIST = 'PreciosHistorico';
export const HEADERS_PRECIOS_HIST = [
  'id_cambio', 'fecha', 'id_control', 'nombre_cliente', 'sucursal_obs',
  'producto', 'precio_anterior', 'precio_nuevo', 'variacion_pct', 'usuario',
];

export interface CambioPrecio {
  id_cambio: string;
  fecha: string;            // YYYY-MM-DD
  id_control: string;
  nombre_cliente: string;
  sucursal_obs: string;
  producto: string;         // 'rucula', 'lechuga_crespa', …
  precio_anterior: number | string;
  precio_nuevo: number | string;
  variacion_pct: number | string;
  usuario: string;
}

// Campos de PrecioVenta que son precios (el resto son identificadores).
export const CAMPOS_PRECIO = [
  'rucula', 'lechuga_crespa', 'hoja_roble', 'bandeja_rucula', 'albahaca',
  'rucula_kg', 'lechuga_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble',
] as const;

export interface CambioDetectado {
  producto: string;
  anterior: number;
  nuevo: number;
  variacionPct: number;
}

// Qué precios cambiaron entre lo que había y lo que se está guardando. Solo cuenta un
// cambio real de valor: guardar el formulario sin tocar nada no ensucia el historial.
export function detectarCambios(anterior: Record<string, any> | undefined, nuevo: Record<string, any>): CambioDetectado[] {
  const out: CambioDetectado[] = [];
  for (const campo of CAMPOS_PRECIO) {
    const a = Number(anterior?.[campo]) || 0;
    const n = Number(nuevo?.[campo]) || 0;
    if (a === n) continue;
    // Un precio que pasa de 0 a algo es "se empezó a vender ese producto", no una suba:
    // se registra igual (es información), pero sin porcentaje, que sería infinito.
    out.push({ producto: campo, anterior: a, nuevo: n, variacionPct: a > 0 ? Math.round(((n - a) / a) * 1000) / 10 : 0 });
  }
  return out;
}

export interface UltimaSuba {
  fecha: string;        // YYYY-MM-DD del último AUMENTO
  diasDesde: number;
  variacionPct: number; // cuánto subió esa vez
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

// Última vez que se le SUBIÓ el precio a un cliente (no cualquier cambio: una baja o una
// corrección no cuentan como "la última suba"). Devuelve null si nunca se registró una,
// que es lo que va a pasar con todos hasta que se haga el primer aumento con esto andando.
export function ultimaSubaPorCliente(historial: CambioPrecio[], hoy: string): Map<string, UltimaSuba> {
  const out = new Map<string, UltimaSuba>();
  for (const c of historial) {
    const nuevo = Number(c.precio_nuevo) || 0;
    const anterior = Number(c.precio_anterior) || 0;
    if (!(nuevo > anterior) || !(anterior > 0)) continue; // solo subas reales
    const fecha = soloFecha(c.fecha);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
    const id = String(c.id_control).trim();
    const prev = out.get(id);
    if (prev && prev.fecha >= fecha) continue;
    out.set(id, {
      fecha,
      diasDesde: Math.round((new Date(hoy + 'T12:00:00').getTime() - new Date(fecha + 'T12:00:00').getTime()) / 86400000),
      variacionPct: Number(c.variacion_pct) || 0,
    });
  }
  return out;
}
