// ── Un lote descartado no es una cosecha ─────────────────────────────────────────────
//
// Lo contó Leo: descartó cuatro lotes en plantinera —espigamiento y hongos— y la app se
// los mostró como "Cosecha · 1.127 pl", en verde. Entendió que la app le había registrado
// otra cosa. No: le registró bien el descarte y lo mostró como si fuera una cosecha.
//
// Por qué pasa. Descartar un lote escribe un movimiento de tipo `cosecha` con CERO
// unidades y todas las plantas como descarte (ver app/api/lotes/descartar). Esa decisión
// tiene un motivo real: las estadísticas de pérdida leen los movimientos de cosecha (ver
// lib/descarte.ts), así que un descarte escrito con otro tipo desaparecería de los
// números — y un descarte invisible es un descarte que se repite.
//
// Pero la pantalla mostraba el tipo crudo. Peor: como `unidades_cosechadas` es 0, el
// número que salía era `plantas_estimadas`, o sea las plantas que se PERDIERON, con la
// etiqueta verde de cosecha al lado. Exactamente al revés de lo que pasó.
//
// Esto no cambia lo que se guarda: deduce, de un movimiento ya escrito, si fue un descarte
// de lote, para poder decirlo. El dato sigue siendo el mismo para las estadísticas y la
// pantalla deja de mentir.

export interface MovimientoParaEtiqueta {
  tipo?: any;
  unidades_cosechadas?: any;
  descarte_reportado?: any;
  plantas_estimadas?: any;
  notas?: any;
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Un movimiento de cosecha del que no salió NADA y en el que se perdió todo.
//
// Se piden las dos condiciones y no una: un lote del que salieron 0 unidades pero sin
// descarte cargado es una cosecha mal registrada, no un descarte, y llamarla descarte
// taparía el error de carga en vez de mostrarlo.
export function esDescarteDeLote(m: MovimientoParaEtiqueta): boolean {
  if (String(m?.tipo || '') !== 'cosecha') return false;
  if (num(m?.unidades_cosechadas) > 0) return false;
  return num(m?.descarte_reportado) > 0 || /lote descartado/i.test(String(m?.notas || ''));
}

// El tipo con el que hay que MOSTRARLO. El guardado no cambia.
export function tipoVisible(m: MovimientoParaEtiqueta): string {
  return esDescarteDeLote(m) ? 'descarte' : String(m?.tipo || '');
}

// Cuántas plantas y de qué. En un descarte el número que importa es lo perdido, y decir
// "1.127 pl" a secas al lado de una etiqueta no alcanza: hay que decir que se perdieron.
export function cantidadVisible(m: MovimientoParaEtiqueta, esRucula: boolean): string {
  const cosechado = num(m?.unidades_cosechadas);
  const estimado = num(m?.plantas_estimadas);
  const fmt = (n: number) => n.toLocaleString('es-AR');

  if (esDescarteDeLote(m)) {
    const perdidas = num(m?.descarte_reportado) || estimado;
    return perdidas > 0 ? `${fmt(perdidas)} pl perdidas` : 'lote descartado';
  }
  if (String(m?.tipo) === 'cosecha' && cosechado > 0) {
    return esRucula ? `${fmt(cosechado)} paq. (${fmt(estimado)} pl)` : `${fmt(cosechado)} pl`;
  }
  if (String(m?.tipo) === 'division' && estimado > 0) return `${fmt(estimado)} quedan`;
  return estimado > 0 ? `${fmt(estimado)} pl` : '';
}

// El motivo, que se guarda en las notas como "Lote descartado: <razón>". Es lo que
// convierte una fila gris en algo que se puede leer dentro de tres meses.
export function motivoDescarte(m: MovimientoParaEtiqueta): string {
  const n = String(m?.notas || '');
  const match = n.match(/lote descartado:\s*(.+)$/i);
  return match ? match[1].trim() : '';
}
