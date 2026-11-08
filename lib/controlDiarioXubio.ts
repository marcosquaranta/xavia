// ── ¿Xubio tiene lo que la app dice que emitió? ──────────────────────────────────────
//
// La app emite la factura y Xubio le devuelve un número. Eso se guarda en
// FacturasEmitidas y se da por hecho. Pero "Xubio contestó" no es lo mismo que "Xubio lo
// guardó": Juan Pablo carga facturas que después no aparecen, o aparecen al otro día.
//
// Esto compara, todos los días, lo que la app registró como emitido contra lo que Xubio
// devuelve, y manda un mail solo cuando hay algo. Es el control que falta porque la
// emisión es el único paso donde la app le cree a Xubio sin volver a preguntar.
//
// LA DISTINCIÓN QUE HACE QUE SIRVA: una factura emitida hace un rato y que todavía no
// aparece casi nunca es un problema —Xubio tarda, y de hecho eso es lo que viene pasando—.
// Una emitida hace tres días y que sigue sin aparecer es mercadería entregada y sin
// facturar. Mezclarlas convierte el aviso en ruido diario y el caso grave se pierde
// adentro.

export interface EmitidaRegistrada {
  numero: string;
  cliente: string;
  fecha_emision: string;  // ISO
  fecha_venta: string;
  cae: string;
}

export type EstadoControl = 'ok' | 'demorada' | 'no_esta' | 'solo_en_xubio';

export interface FilaControlDiario {
  numero: string;
  cliente: string;
  fechaEmision: string;   // YYYY-MM-DD
  diasDesdeEmision: number;
  estado: EstadoControl;
  importeXubio?: number;
}

export interface ResultadoControlDiario {
  desde: string;
  hasta: string;
  revisadas: number;
  ok: number;
  demoradas: FilaControlDiario[];
  faltantes: FilaControlDiario[];
  soloEnXubio: FilaControlDiario[];
  hayProblema: boolean;
}

// Cuántos días se le dan a Xubio para que la factura aparezca antes de tratarla como un
// problema. Uno cubre el caso que Marcos describe —se factura un día y aparece al
// siguiente— sin dejar pasar una que de verdad no está.
export const DIAS_GRACIA_XUBIO = 1;

// Hasta cuántos días atrás se revisa. Más que esto ya no es un control diario: es el
// control de facturación del mes, que existe aparte y cruza todo el período.
export const DIAS_VENTANA_CONTROL = 7;

const soloDia = (v: any) => String(v || '').split(/[T ]/)[0];
const diasEntre = (a: string, b: string) => {
  const x = Date.parse(`${a}T12:00:00Z`), y = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return Math.round((y - x) / 86_400_000);
};
const clave = (n: any) => String(n || '').trim().toUpperCase();

export function controlDiario(
  emitidas: EmitidaRegistrada[],
  comprobantesXubio: any[],
  hoy: string,
  diasVentana = DIAS_VENTANA_CONTROL,
  diasGracia = DIAS_GRACIA_XUBIO,
): ResultadoControlDiario {
  const desde = (() => {
    const d = new Date(Date.parse(`${hoy}T12:00:00Z`) - diasVentana * 86_400_000);
    return d.toISOString().slice(0, 10);
  })();

  const enXubio = new Map<string, any>();
  for (const c of comprobantesXubio || []) {
    const n = clave(c?.numeroDocumento);
    if (n) enXubio.set(n, c);
  }

  const demoradas: FilaControlDiario[] = [];
  const faltantes: FilaControlDiario[] = [];
  let ok = 0, revisadas = 0;
  const numerosDeLaApp = new Set<string>();

  for (const e of emitidas || []) {
    const f = soloDia(e.fecha_emision);
    if (!f || f < desde || f > hoy) continue;
    const n = clave(e.numero);
    if (!n) continue;
    numerosDeLaApp.add(n);
    revisadas++;

    const c = enXubio.get(n);
    if (c) { ok++; continue; }

    const dias = diasEntre(f, hoy);
    const fila: FilaControlDiario = {
      numero: e.numero, cliente: e.cliente, fechaEmision: f, diasDesdeEmision: dias,
      estado: dias <= diasGracia ? 'demorada' : 'no_esta',
    };
    (dias <= diasGracia ? demoradas : faltantes).push(fila);
  }

  // ── Lo que está en Xubio y no salió de la app ──────────────────────────────────────
  //
  // No es un error —se puede facturar a mano allá— pero sí es algo que hay que saber: cada
  // una de esas es una venta que la app no tiene, así que no está en el resultado, ni en la
  // deuda del cliente, ni en el reclamo del lunes.
  const soloEnXubio: FilaControlDiario[] = [];
  for (const c of comprobantesXubio || []) {
    const f = soloDia(c?.fecha);
    if (!f || f < desde || f > hoy) continue;
    // Solo facturas: una nota de crédito no tiene por qué haber salido de la app.
    if (Number(c?.tipo) !== 1) continue;
    const n = clave(c?.numeroDocumento);
    if (!n || numerosDeLaApp.has(n)) continue;
    soloEnXubio.push({
      numero: String(c?.numeroDocumento || ''),
      cliente: String(c?.cliente?.nombre || c?.cliente || '').trim(),
      fechaEmision: f,
      diasDesdeEmision: diasEntre(f, hoy),
      estado: 'solo_en_xubio',
      importeXubio: Math.round(Number(c?.importetotal) || 0),
    });
  }

  const orden = (a: FilaControlDiario, b: FilaControlDiario) => b.diasDesdeEmision - a.diasDesdeEmision;
  faltantes.sort(orden); demoradas.sort(orden); soloEnXubio.sort(orden);

  return {
    desde, hasta: hoy, revisadas, ok, demoradas, faltantes, soloEnXubio,
    // Las demoradas solas NO son un problema: es el comportamiento normal de Xubio. Si
    // dispararan el mail, llegaría uno todos los días y dejaría de leerse justo cuando
    // aparezca una de verdad.
    hayProblema: faltantes.length > 0 || soloEnXubio.length > 0,
  };
}
