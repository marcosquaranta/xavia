// ── Dos fichas para el mismo cliente ─────────────────────────────────────────────────
//
// Pasa solo: un cliente se carga una vez con la razón social que usa Xubio y otra con el
// nombre con el que lo llamamos puertas adentro. Nadie lo nota, porque las dos fichas
// funcionan: cada una recibe sus facturas y las dos muestran deuda.
//
// Lo que rompe es todo lo que agrupa POR CLIENTE. La deuda aparece partida en dos filas, el
// recordatorio sale dos veces o ninguna —si una de las dos tiene el aviso apagado—, el
// reparto de cobros se hace por separado y el ranking de clientes miente. Nada de eso da
// error: da números que se leen bien y están mal.
//
// Esto no une nada: señala las fichas que se parecen para que una persona decida. Unir dos
// clientes es irreversible del lado de las facturas ya emitidas, así que la decisión no
// puede ser automática.

export interface ClienteParaDuplicados {
  id_control: string;
  nombre_xubio?: string;
  alias?: string;
  nombre_display?: string;
  sucursales?: string;
  activo?: string;
}

export interface ParSospechoso {
  a: { id_control: string; nombre: string; activo: boolean };
  b: { id_control: string; nombre: string; activo: boolean };
  // Qué texto tienen en común. Es lo que permite descartar un falso positivo de un vistazo
  // sin abrir las dos fichas: "la reina" y "la reina del sur" comparten "la reina" y pueden
  // ser dos negocios distintos.
  comun: string;
}

const norm = (s: any) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Los nombres por los que se conoce a un cliente, todos juntos. Las sucursales entran
// porque es donde suele aparecer el otro nombre: "Heroica" cargado como sucursal de una
// ficha y como nombre de otra es exactamente el caso que hay que encontrar.
function nombresDe(c: ClienteParaDuplicados): string[] {
  const crudos = [c.nombre_xubio, c.alias, c.nombre_display, ...String(c.sucursales || '').split(/[|,;]+/)];
  const vistos = new Set<string>();
  for (const x of crudos) {
    const n = norm(x);
    // Menos de cinco letras no alcanza para afirmar nada: "sur", "alto" o "srl" coinciden
    // entre negocios que no tienen nada que ver, y un detector que grita siempre se apaga.
    if (n.length >= 5) vistos.add(n);
  }
  return [...vistos];
}

export function nombreVisible(c: ClienteParaDuplicados): string {
  return String(c.alias || c.nombre_display || c.nombre_xubio || c.id_control).trim();
}

export function clientesDuplicados(clientes: ClienteParaDuplicados[]): ParSospechoso[] {
  const conNombres = (clientes || []).map((c) => ({ c, nombres: nombresDe(c) }));
  const out: ParSospechoso[] = [];

  for (let i = 0; i < conNombres.length; i++) {
    for (let j = i + 1; j < conNombres.length; j++) {
      const A = conNombres[i], B = conNombres[j];
      if (String(A.c.id_control) === String(B.c.id_control)) continue;
      let comun = '';
      for (const na of A.nombres) {
        for (const nb of B.nombres) {
          // Uno contenido en el otro, no solo iguales: "heroica" y "heroica alto" son el
          // mismo negocio escrito distinto, que es justo lo que se busca.
          if (na === nb || na.includes(nb) || nb.includes(na)) {
            const m = na.length <= nb.length ? na : nb;
            if (m.length > comun.length) comun = m;
          }
        }
      }
      if (!comun) continue;
      out.push({
        a: { id_control: String(A.c.id_control), nombre: nombreVisible(A.c), activo: String(A.c.activo || '').toUpperCase() !== 'NO' },
        b: { id_control: String(B.c.id_control), nombre: nombreVisible(B.c), activo: String(B.c.activo || '').toUpperCase() !== 'NO' },
        comun,
      });
    }
  }
  // El parecido más largo primero: es el más probable de ser real.
  return out.sort((x, y) => y.comun.length - x.comun.length);
}
