// ── Dónde entra la plata ─────────────────────────────────────────────────────────────
//
// Xubio devuelve todas las cuentas que alguna vez recibieron un cobro, y son muchas más de
// las que se usan: cuentas viejas, cuentas de prueba, cuentas de otro circuito. Elegir
// entre veinte opciones cuando en la práctica son tres es una invitación a equivocarse, y
// equivocarse acá manda la plata a la cuenta contable incorrecta.
//
// Las tres reales, en orden de uso. El orden importa: la primera es la que queda elegida
// cuando el aviso no dice nada, que es el caso más común.
export const CUENTAS_COBRO = ['brubank', 'macro', 'caja mq', 'caja marce'] as const;

export interface CuentaOpcion { id: number; nombre: string }

const norm = (s: any) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function rango(nombre: string): number {
  const n = norm(nombre);
  const i = CUENTAS_COBRO.findIndex(c => n.includes(c));
  return i === -1 ? CUENTAS_COBRO.length : i;
}

// Solo las tres, ordenadas. Si ninguna matchea —porque en Xubio se llaman distinto— se
// devuelven todas: es preferible una lista larga a una pantalla donde no se puede
// registrar ningún cobro.
export function cuentasElegibles<T extends CuentaOpcion>(cuentas: T[]): T[] {
  const conocidas = cuentas.filter(c => rango(c.nombre) < CUENTAS_COBRO.length);
  if (!conocidas.length) return cuentas;
  return [...conocidas].sort((a, b) => rango(a.nombre) - rango(b.nombre) || a.nombre.localeCompare(b.nombre));
}

// Qué cuenta sugiere el texto de un aviso. "Transferencia a Banco Macro" tiene que quedar
// en Macro, no en Brubank. Si el texto no dice nada —o nombra dos— gana la primera de la
// lista, que es la que recibe casi todo.
export function cuentaSugerida<T extends CuentaOpcion>(cuentas: T[], texto: string): T | undefined {
  const elegibles = cuentasElegibles(cuentas);
  if (!elegibles.length) return undefined;
  const t = norm(texto);
  if (t) {
    const nombradas = CUENTAS_COBRO.filter(c => t.includes(c));
    // Una sola mencionada: es esa. Dos o más: no hay forma de saber cuál, va la primera.
    if (nombradas.length === 1) {
      const hit = elegibles.find(c => norm(c.nombre).includes(nombradas[0]));
      if (hit) return hit;
    }
  }
  return elegibles[0];
}
