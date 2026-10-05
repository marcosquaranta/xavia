import type { ClienteVenta } from './types';
import { nombreClienteVisible } from './clientes';

// ── Control de la letra del comprobante ───────────────────────────────────────────────
//
// La app pide una factura B y Xubio puede devolver una A. No es una hipótesis: pasó.
//
// El motivo es que la letra no la elige la app. La app elige el PUNTO DE VENTA —manda el id
// del PV "A" o el del PV "B" según cómo esté configurado el cliente acá— y la letra final la
// resuelve Xubio, mirando la condición frente al IVA que tiene cargada ESE cliente en SU
// base. Si allá figura como Responsable Inscripto, la factura sale A aunque nosotros
// hayamos pedido el PV de las B: para AFIP, entre dos responsables inscriptos corresponde A.
//
// O sea que son dos bases de datos que pueden decir cosas distintas sobre el mismo cliente,
// y hasta ahora la app no se enteraba: guardaba el número que le devolvía Xubio sin mirar
// la letra. El error aparecía cuando el cliente recibía una factura que no esperaba.
//
// Acá hay dos controles:
//
// 1. Al emitir: se compara la letra del número que devolvió Xubio contra la que
//    correspondía. Si no coinciden, queda marcado en la factura emitida.
// 2. Sobre lo ya emitido: se revisan los comprobantes que están en la copia local de Xubio
//    y se listan los que salieron con otra letra. Sirve para ver de una cuántos casos hay
//    sin abrir Xubio cliente por cliente.
//
// Ninguno de los dos corrige nada: una factura emitida no se puede cambiar desde acá, y la
// corrección de fondo es en Xubio (la condición de IVA del cliente) o en la app (si el que
// está mal es el tipo de factura configurado). Lo que hacen es que el desajuste se vea.

const normNombre = (s: string) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();

// La letra configurada para un cliente. Con trim y mayúsculas: un " b " cargado a mano no
// puede hacer que el control diga que todo está mal.
export function letraEsperada(cliente: { tipo_factura?: string } | undefined | null): string {
  return String(cliente?.tipo_factura || '').trim().toUpperCase();
}

// La letra y el punto de venta de un número de comprobante ("A-00002-00000878" → A, 2).
export function letraYPuntoDeVenta(numero: any): { letra: string; pv: string } {
  const t = String(numero ?? '').trim().toUpperCase();
  const m = t.match(/^([A-Z])[\s-]+(\d+)/);
  if (!m) return { letra: '', pv: '' };
  return { letra: m[1], pv: String(Number(m[2])) };
}

export interface DesajusteLetra {
  cliente: string;
  numero: string;
  fecha: string;
  importe: number;
  emitida: string;    // la letra que salió
  esperada: string;   // la que correspondía según la app
}

// Los comprobantes que salieron con una letra distinta a la configurada.
//
// Las notas de crédito y cualquier comprobante que no se pueda identificar quedan afuera:
// solo se compara lo que tiene letra y un cliente que exista de los dos lados. Un cliente
// que no matchea por nombre no es un desajuste de letra —es otro problema, el de siempre
// con los nombres— y mezclarlos haría que este control no se pueda leer.
export function desajustesDeLetra(comprobantes: any[], clientes: ClienteVenta[]): DesajusteLetra[] {
  const porNombre = new Map<string, ClienteVenta>();
  for (const c of clientes) {
    const k = normNombre(c.nombre_xubio);
    if (k && !porNombre.has(k)) porNombre.set(k, c);
  }

  const out: DesajusteLetra[] = [];
  for (const c of comprobantes) {
    const numero = String(c?.numeroDocumento || c?.numero || '');
    const { letra } = letraYPuntoDeVenta(numero);
    if (!letra) continue;
    // El nombre viene anidado en `cliente.nombre` tanto desde la API como desde la copia
    // local. Leer `c.cliente` directo da "[object Object]" y ningún cliente matchea nunca:
    // el control no fallaría, simplemente no encontraría jamás un desajuste.
    const nombre = String(c?.cliente?.nombre ?? c?.nombre ?? (typeof c?.cliente === 'string' ? c.cliente : '') ?? '');
    const cli = porNombre.get(normNombre(nombre));
    if (!cli) continue;
    const esperada = letraEsperada(cli);
    if (!esperada || esperada === letra) continue;
    out.push({
      cliente: nombreClienteVisible(cli) || nombre,
      numero, fecha: String(c?.fecha || '').split(/[T ]/)[0],
      importe: Number(c?.importetotal ?? c?.importe ?? 0) || 0,
      emitida: letra, esperada,
    });
  }
  // El más reciente primero: si esto se empezó a romper, lo que importa es desde cuándo.
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// Qué letras viene emitiendo realmente cada punto de venta.
//
// Responde la pregunta de fondo cuando aparece un desajuste: si el PV que la app usa para
// las B emitió cien B y tres A, el problema son esos tres clientes; si emitió todas A, el
// que está mal es el PV y hay que revisar la configuración, no los clientes.
export function letrasPorPuntoDeVenta(comprobantes: any[]): { pv: string; letras: { letra: string; n: number }[] }[] {
  const mapa = new Map<string, Map<string, number>>();
  for (const c of comprobantes) {
    const { letra, pv } = letraYPuntoDeVenta(String(c?.numeroDocumento || c?.numero || ''));
    if (!letra || !pv) continue;
    const m = mapa.get(pv) || new Map<string, number>();
    m.set(letra, (m.get(letra) || 0) + 1);
    mapa.set(pv, m);
  }
  return [...mapa.entries()]
    .map(([pv, m]) => ({
      pv,
      letras: [...m.entries()].map(([letra, n]) => ({ letra, n })).sort((a, b) => b.n - a.n),
    }))
    .sort((a, b) => a.pv.localeCompare(b.pv));
}
