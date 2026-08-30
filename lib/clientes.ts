import type { ClienteVenta } from './types';

// Nombre con el que se muestra un cliente en TODA la app. La hoja Clientes tiene tres
// nombres distintos y hasta ahora cada pantalla resolvía el suyo a mano, siempre con el
// mismo criterio incompleto (`nombre_display || nombre_xubio`), que dejaba el alias afuera:
//
//   nombre_xubio   Razón social. Es la que se usa para FACTURAR — no se toca acá.
//                  Ej: "NAF S.R.L."
//   nombre_display Nombre para mostrar. Al dar de alta un cliente se completa solo con la
//                  razón social si se deja vacío (ver /api/admin/clientes-venta), así que
//                  en la mayoría de los clientes es igual a nombre_xubio y no aporta nada.
//   alias          Cómo se le dice al cliente en la quinta. Ej: "Mamina".
//
// Por eso el alias va PRIMERO: es el único de los tres que alguien se tomó el trabajo de
// escribir a propósito. Si está vacío se cae a display y después a la razón social.
//
// OJO: esto es solo para pantalla. La facturación a Xubio sigue usando nombre_xubio
// (ver lib/facturacionEmitir.ts) — ahí el nombre tiene que ser el legal, no el apodo.
export function nombreClienteVisible(c: Pick<ClienteVenta, 'alias' | 'nombre_display' | 'nombre_xubio' | 'id_control'> | undefined | null): string {
  if (!c) return '';
  return String(c.alias || '').trim()
    || String(c.nombre_display || '').trim()
    || String(c.nombre_xubio || '').trim()
    || String(c.id_control || '');
}

// Mapa id_control → nombre visible, listo para usar en cualquier pantalla que tenga ids
// sueltos (ventas, cajones, facturación). String(...) en la clave porque Sheets devuelve
// los id_control numéricos como number, no como texto.
export function mapaNombresClientes(clientes: ClienteVenta[]): Map<string, string> {
  return new Map(clientes.map((c) => [String(c.id_control), nombreClienteVisible(c)]));
}
