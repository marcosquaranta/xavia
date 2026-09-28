// ── Dónde entra la plata ─────────────────────────────────────────────────────────────
//
// Xubio devuelve todas las cuentas que alguna vez recibieron un cobro, y son muchas más de
// las que se usan: cuentas viejas, cuentas de prueba, cuentas de otro circuito. Elegir
// entre veinte opciones cuando en la práctica son tres es una invitación a equivocarse, y
// equivocarse acá manda la plata a la cuenta contable incorrecta.
//
// Las cuatro reales, en orden de uso. El orden importa: la primera es la que queda elegida
// cuando el aviso no dice nada, que es el caso más común.
// Cada nombre es un PEDAZO del nombre real, no el nombre completo: en Xubio la misma cuenta
// está escrita de formas que no se pueden anticipar —"Banco Macro" y no "Macro", "CAJAMQ"
// sin espacio y no "Caja MQ"— y pedir el nombre exacto hacía que la cuenta simplemente no
// apareciera arriba, sin ningún error que lo explicara. Por eso se compara por `clave`, que
// ignora espacios y puntuación.
export const CUENTAS_COBRO = ['brubank', 'macro', 'caja mq', 'caja marce'] as const;

export interface CuentaOpcion { id: number; nombre: string }

const norm = (s: any) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Solo letras y números: es lo que hace que "CAJAMQ", "Caja MQ" y "caja-mq" sean la misma
// cosa, y que "macro" encuentre a "Banco Macro". Sin esto la comparación dependía de cómo
// alguien tipeó el nombre en Xubio hace dos años.
const clave = (s: any) => norm(s).replace(/[^a-z0-9]/g, '');

function rango(nombre: string): number {
  const n = clave(nombre);
  const i = CUENTAS_COBRO.findIndex(c => n.includes(clave(c)));
  return i === -1 ? CUENTAS_COBRO.length : i;
}

// Las cuentas por las que entra plata, primero; el resto detrás.
//
// Xubio devuelve el PLAN DE CUENTAS completo —78 cuentas, casi todas de gastos: Almuerzos,
// Combustible, Ropa de Trabajo— y elegir ahí adentro la cuenta donde entró una
// transferencia es una invitación a imputar mal. Por eso las de cobro van arriba.
//
// Pero no se esconde el resto: si una cuenta de cobro está en Xubio con otro nombre del
// que espera CUENTAS_COBRO, dejarla afuera haría imposible registrar ese cobro. Se marca
// la separación y listo — la lista ordenada resuelve el 95% de los casos sin bloquear el
// 5% restante.
export function cuentasElegibles<T extends CuentaOpcion>(cuentas: T[]): T[] {
  return [...cuentas].sort((a, b) => rango(a.nombre) - rango(b.nombre) || a.nombre.localeCompare(b.nombre));
}

// Cuántas de las primeras son "de cobro": la pantalla las separa visualmente del resto.
export function cantidadPreferidas(cuentas: CuentaOpcion[]): number {
  return cuentas.filter(c => rango(c.nombre) < CUENTAS_COBRO.length).length;
}

// Qué cuenta sugiere el texto de un aviso. "Transferencia a Banco Macro" tiene que quedar
// en Macro, no en Brubank. Si el texto no dice nada —o nombra dos— gana la primera de la
// lista, que es la que recibe casi todo.
export function cuentaSugerida<T extends CuentaOpcion>(cuentas: T[], texto: string): T | undefined {
  const elegibles = cuentasElegibles(cuentas);
  if (!elegibles.length) return undefined;
  // Si el aviso dijo explícitamente dónde entró, manda eso y se ignora el resto del texto.
  // Es importante: el cuerpo de un mail reenviado suele arrastrar NUESTROS datos de pago
  // —que nombran Brubank— abajo de todo, y entonces un aviso que dice claramente "Banco
  // Macro" nombraba dos cuentas, quedaba ambiguo, y ganaba la de siempre.
  const explicita = extraerCuentaDeclarada(texto);
  if (explicita) {
    const k = clave(explicita);
    // Primero por nombre completo, después por la palabra que identifica a la cuenta. La
    // segunda vuelta es la que importa en la práctica: el aviso escribe "Bco. Macro" y en
    // Xubio está como "Banco Macro", que no se contienen en ningún sentido. Lo que sí
    // comparten es "macro", y eso es lo que CUENTAS_COBRO guarda.
    const hit = elegibles.find(c => clave(c.nombre).includes(k) || k.includes(clave(c.nombre)))
      || (() => {
        const nombradas = CUENTAS_COBRO.filter(c => k.includes(clave(c)));
        if (nombradas.length !== 1) return undefined;
        return elegibles.find(c => clave(c.nombre).includes(clave(nombradas[0])));
      })();
    if (hit) return hit;
  }
  const t = clave(texto);
  if (t) {
    const nombradas = CUENTAS_COBRO.filter(c => t.includes(clave(c)));
    // Una sola mencionada: es esa. Dos o más: no hay forma de saber cuál, va la primera.
    if (nombradas.length === 1) {
      const hit = elegibles.find(c => clave(c.nombre).includes(clave(nombradas[0])));
      if (hit) return hit;
    }
  }
  return elegibles[0];
}

// ── Cómo queda anotado en el aviso a qué cuenta entró la plata ───────────────────────
//
// La IA lee la orden de pago (casi siempre un PDF) y saca el banco de destino, pero el PDF
// no se guarda: lo único que queda es la descripción del movimiento. Por eso el dato se
// escribe ahí con esta marca, y se vuelve a leer desde ahí. Un solo lugar define las dos
// puntas para que no se desincronicen.
export const MARCA_CUENTA = 'entró en ';

export function marcarCuentaDeclarada(nombre: string): string {
  return `${MARCA_CUENTA}${String(nombre || '').trim()}`;
}

// El nombre de cuenta que el aviso declaró, o '' si no declaró ninguna. Corta en el
// separador de campos para no arrastrarse el resto de la descripción.
export function extraerCuentaDeclarada(texto: string): string {
  const t = String(texto || '');
  const i = norm(t).indexOf(norm(MARCA_CUENTA));
  if (i === -1) return '';
  return t.slice(i + MARCA_CUENTA.length).split('·')[0].trim().slice(0, 60);
}
