// ── Registrar el cobro ya, mandarlo a Xubio después ──────────────────────────────────
//
// Imputar un cobro tardaba una eternidad, y no por escribirlo en Xubio: por lo que hay que
// leer ANTES de poder escribirlo. Para armar una cobranza, Xubio exige el circuito
// contable, la moneda, la cotización y el instrumento de cobro, y ninguno de esos datos los
// expone como tal. Se deducen de las cobranzas anteriores — 180 días de cobranzas, más el
// listado completo de clientes, más los circuitos, más las cuentas si hay retención.
//
// Son tres o cuatro consultas pesadas para una sola escritura, y hay que esperarlas con la
// pantalla abierta mientras alguien tiene al cliente enfrente.
//
// Decisión de Marcos: registrar el cobro en la app en el acto y mandarlo a Xubio una vez
// por día, todo junto. La factura deja de reclamarse al instante, que es lo que importa
// cuando entra la plata; el comprobante en Xubio puede esperar unas horas.
//
// LO QUE ESTO ABRE, y hay que mirarlo de frente: entre que se registra y se manda, la app
// dice que el cobro existe y Xubio no lo tiene. Esa ventana es nueva y es real. Por eso:
//
//  · el cobro queda con estado `pendiente_xubio`, no `registrado`: no se puede confundir
//    uno que ya está allá con uno que todavía no;
//  · la pantalla de Cobranzas dice cuántos están esperando y desde cuándo;
//  · un cobro que lleva más de un día esperando es un problema —el envío diario no corrió,
//    o Xubio lo rechaza— y sale avisado, porque un pendiente que nadie mira es plata
//    cobrada que nunca llega a la contabilidad.
//
// Nada de esto cambia qué factura se da por cobrada: eso sale de la hoja de cobros de la
// app desde siempre, y un cobro pendiente de envío ya está en esa hoja.

import type { CobroRegistrado } from './cobros';

export const ESTADO_PENDIENTE = 'pendiente_xubio';

// Cuántos días puede esperar un cobro antes de que sea un problema. Uno: el envío corre
// todos los días, así que a las 24 horas o no corrió o Xubio lo rechazó.
export const DIAS_ESPERA_NORMAL = 1;

export interface CobroEsperando {
  id_cobro: string;
  cliente: string;
  fecha: string;
  importe: number;
  dias: number;
  demorado: boolean;
  error: string;
}

const soloDia = (v: any) => String(v || '').split(/[T ]/)[0];

const diasEntre = (desde: string, hasta: string) => {
  const a = Date.parse(`${desde}T12:00:00Z`), b = Date.parse(`${hasta}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
};

export function esPendiente(c: { estado?: any }): boolean {
  return String(c?.estado || '').trim() === ESTADO_PENDIENTE;
}

// Los cobros que todavía no llegaron a Xubio, con cuánto llevan esperando.
export function cobrosEsperando(
  cobros: (CobroRegistrado & { error_xubio?: string })[],
  hoy: string,
  diasNormal = DIAS_ESPERA_NORMAL,
): CobroEsperando[] {
  const out: CobroEsperando[] = [];
  for (const c of cobros || []) {
    if (!esPendiente(c)) continue;
    // La fecha de registro, no la del cobro: lo que se mide es cuánto hace que está en la
    // cola, no de cuándo es la plata. Un cheque fechado para el mes que viene se registra
    // hoy y tiene que salir hoy.
    const desde = soloDia(c.fecha_registro) || soloDia(c.fecha);
    const dias = desde ? diasEntre(desde, hoy) : 0;
    out.push({
      id_cobro: String(c.id_cobro || ''),
      cliente: String(c.cliente || ''),
      fecha: soloDia(c.fecha),
      importe: Number(c.importe) || 0,
      dias,
      demorado: dias > diasNormal,
      error: String((c as any).error_xubio || '').trim(),
    });
  }
  return out.sort((a, b) => b.dias - a.dias || b.importe - a.importe);
}

export function resumenEspera(lista: CobroEsperando[]): {
  cantidad: number; monto: number; demorados: number; conError: number;
} {
  return {
    cantidad: lista.length,
    monto: lista.reduce((a, c) => a + c.importe, 0),
    demorados: lista.filter((c) => c.demorado).length,
    conError: lista.filter((c) => c.error).length,
  };
}
