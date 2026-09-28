// ── Dónde entra la plata ─────────────────────────────────────────────────────────────
//
// Xubio devuelve todas las cuentas que alguna vez recibieron un cobro, y son muchas más de
// las que se usan: cuentas viejas, cuentas de prueba, cuentas de otro circuito. Elegir
// entre veinte opciones cuando en la práctica son tres es una invitación a equivocarse, y
// equivocarse acá manda la plata a la cuenta contable incorrecta.
//
// Las seis reales, en orden de uso. El orden importa: la primera es la que queda elegida
// cuando el aviso no dice nada, que es el caso más común.
//
// Cada nombre es un PEDAZO del nombre real, no el nombre completo: en Xubio la misma cuenta
// está escrita de formas que no se pueden anticipar —"Banco Macro" y no "Macro", "CAJAMQ"
// sin espacio y no "Caja MQ"— y pedir el nombre exacto hacía que la cuenta simplemente no
// apareciera arriba, sin ningún error que lo explicara. Por eso se compara por `clave`, que
// ignora espacios y puntuación.
export const CUENTAS_COBRO = [
  'brubank',      // recibe casi todo: es la que queda elegida cuando el aviso no dice nada
  'macro',
  'caja mq',
  'caja marce',
  'caja fl',
  'caja jp',
] as const;

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

// Solo las cuentas por las que entra plata.
//
// Xubio devuelve el plan de cuentas entero —78 cuentas, casi todas de gastos: Almuerzos,
// Combustible, Ropa de Trabajo— y buscar ahí adentro la cuenta donde entró una
// transferencia es una invitación a imputar mal. Se muestran solo las de CUENTAS_COBRO.
//
// La única excepción es no dejar a nadie sin poder trabajar: si NINGUNA de las de la lista
// aparece en Xubio, se devuelven todas. Un desplegable largo es molesto; uno vacío hace
// imposible registrar el cobro.
export function cuentasElegibles<T extends CuentaOpcion>(cuentas: T[]): T[] {
  const preferidas = cuentas
    .filter(c => rango(c.nombre) < CUENTAS_COBRO.length)
    .sort((a, b) => rango(a.nombre) - rango(b.nombre) || a.nombre.localeCompare(b.nombre));
  if (preferidas.length) return preferidas;
  return [...cuentas].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export function cantidadPreferidas(cuentas: CuentaOpcion[]): number {
  return cuentas.filter(c => rango(c.nombre) < CUENTAS_COBRO.length).length;
}

// Cuáles de las cuentas esperadas NO están en Xubio. Se informa en pantalla en vez de
// dejarlo pasar: que falte una es un dato accionable —hay que crearla en Xubio o está
// escrita de otra forma— y sin decirlo se vive como "la app no me deja elegirla".
export function cuentasFaltantes(cuentas: CuentaOpcion[]): string[] {
  return CUENTAS_COBRO
    .filter(k => !cuentas.some(c => clave(c.nombre).includes(clave(k))))
    .map(k => ETIQUETAS[k] || k);
}

// Cómo se nombra cada una en pantalla. Las claves son pedazos de nombre pensados para
// matchear, no para leer: avisar que falta "macro" no le dice nada a nadie.
const ETIQUETAS: Record<string, string> = {
  brubank: 'Brubank',
  macro: 'Banco Macro',
  'caja mq': 'Caja MQ',
  'caja marce': 'Caja Marce',
  'caja fl': 'Caja FL',
  'caja jp': 'Caja JP',
};

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
