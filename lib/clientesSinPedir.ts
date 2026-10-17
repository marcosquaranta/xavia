// ══ Clientes que dejaron de pedir ══════════════════════════════════════════════════════
//
// Un cliente no avisa que se va: deja de pedir. Y entre los cientos de líneas de venta de
// cada semana, una que falta no se ve — nadie mira la lista de clientes buscando ausencias.
// Para cuando se nota, ya pasó un mes y la conversación es otra.
//
// Por eso el aviso sale solo, y solo con los que están en la ventana donde todavía se puede
// hacer algo:
//
//   - Menos de 7 días: no es nada. Un cliente que pide dos veces por semana puede saltear
//     una sin que signifique nada, y avisar por eso enseña a ignorar el aviso.
//   - Entre 7 y 20 días: acá es donde sirve llamar. Dejó de pedir hace poco, el motivo
//     todavía está fresco y probablemente se arregle con una llamada.
//   - Más de 20 días: ya no es "dejó de pedir", es un cliente perdido o estacional. Eso no
//     se resuelve con un aviso semanal, y mezclarlo con los otros llena la lista de nombres
//     que van a estar ahí todas las semanas hasta que alguien los saque. Son justo los que
//     hacen que el mail se deje de leer.
//
// Los umbrales los definió Marcos (octubre 2026).

import type { VentaDia, ClienteVenta } from './types';
import { nombreClienteVisible } from './clientes';
import { PROD_KEYS } from './articulos';

export const DIAS_AVISO = 6;      // más de esto sin pedir, entra al aviso
export const DIAS_DESCARTE = 20;  // más de esto, ya no es un cliente que "dejó de pedir"

export interface ClienteSinPedir {
  id_control: string;
  nombre: string;
  dias: number;
  ultimaVenta: string;   // YYYY-MM-DD
  // Cuánto compraba, para poder priorizar a quién llamar primero: perder al que compra
  // todas las semanas no es lo mismo que perder al que compra una vez por mes.
  unidadesUltimas8Semanas: number;
  vecesUltimas8Semanas: number;
}

const soloDia = (f: any) => String(f || '').split(/[T ]/)[0];

// Una fila de venta "cuenta" como pedido si tiene alguna cantidad cargada. Se miran TODAS
// las claves de producto, incluidas las dadas de baja: un pedido viejo de un artículo que ya
// no se hace fue un pedido igual.
function tieneCantidad(v: VentaDia): boolean {
  return PROD_KEYS.some((k) => (Number((v as any)[k]) || 0) > 0);
}

export function clientesSinPedir(
  ventas: VentaDia[],
  clientes: ClienteVenta[],
  hoyStr: string,
): ClienteSinPedir[] {
  const hoy = new Date(hoyStr + 'T12:00:00');
  const desde8Sem = new Date(hoy.getTime() - 56 * 86400000);

  // Última venta y volumen reciente, en una sola pasada por cliente.
  const porCliente = new Map<string, { ultima: string; unidades: number; veces: number }>();
  for (const v of ventas) {
    if (!tieneCantidad(v)) continue;
    const f = soloDia(v.fecha);
    if (!f || f > hoyStr) continue; // una venta con fecha futura no prueba que el cliente esté activo hoy
    const id = String(v.id_control);
    const prev = porCliente.get(id) || { ultima: '', unidades: 0, veces: 0 };
    if (f > prev.ultima) prev.ultima = f;
    if (new Date(f + 'T12:00:00') >= desde8Sem) {
      prev.unidades += PROD_KEYS.reduce((a, k) => a + (Number((v as any)[k]) || 0), 0);
      prev.veces += 1;
    }
    porCliente.set(id, prev);
  }

  const out: ClienteSinPedir[] = [];
  for (const c of clientes) {
    if (String(c.activo || '').trim().toUpperCase() === 'NO') continue;
    const datos = porCliente.get(String(c.id_control));
    // Sin ninguna venta nunca no es un cliente que dejó de pedir: es uno que todavía no
    // empezó, o una fila de la planilla que nunca se usó. Avisar por esos llenaría la lista
    // de nombres que no significan nada.
    if (!datos || !datos.ultima) continue;
    const dias = Math.round((hoy.getTime() - new Date(datos.ultima + 'T12:00:00').getTime()) / 86400000);
    if (dias <= DIAS_AVISO || dias > DIAS_DESCARTE) continue;
    out.push({
      id_control: String(c.id_control),
      nombre: nombreClienteVisible(c),
      dias,
      ultimaVenta: datos.ultima,
      unidadesUltimas8Semanas: Math.round(datos.unidades),
      vecesUltimas8Semanas: datos.veces,
    });
  }
  // Primero el que más compraba: es a quien conviene llamar antes si no se puede llamar a
  // todos. A igual volumen, el que hace más que no pide.
  return out.sort((a, b) => b.unidadesUltimas8Semanas - a.unidadesUltimas8Semanas || b.dias - a.dias);
}
