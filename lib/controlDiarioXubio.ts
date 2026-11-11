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

import { claveComprobante } from './comprobantes';

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
  // ── Por qué la app no la tiene ──────────────────────────────────────────────────
  //
  // "Cargada a mano en Xubio" es una conclusión, no un hecho: lo único que se sabe es
  // que ese número no figura de este lado. Hay dos situaciones muy distintas detrás y
  // hacen falta cosas distintas:
  //
  //  - no hay ninguna venta de ese cliente por esos días: se facturó algo que la app
  //    nunca tuvo. Hay que cargarlo acá o el resultado queda corto.
  //  - hay una venta cargada, sin número de factura: la venta está, la factura existe,
  //    y lo que falló fue escribir el número de vuelta. No falta plata: falta un dato,
  //    y mientras tanto esa venta figura "sin facturar" en la otra alerta.
  //
  // Decir cuál de las dos es convierte un aviso que no se puede accionar en uno que sí.
  ventaSinNumero?: { fecha: string; cliente: string; dias: number };
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
// ── Comparar números de comprobante como en todo el resto ─────────────────────────
//
// Acá se comparaba con trim().toUpperCase(), o sea literal. Todo el resto de la app usa
// claveComprobante, que ignora los ceros a la izquierda y los separadores: "A-00002-00000993"
// y "A 2-993" son la misma factura. Con la comparación literal, una factura que SÍ salió
// de la app aparecía como cargada a mano en Xubio solo porque el número estaba escrito de
// otra forma de un lado que del otro.
const clave = (n: any) => claveComprobante(n);

export function controlDiario(
  emitidas: EmitidaRegistrada[],
  comprobantesXubio: any[],
  hoy: string,
  diasVentana = DIAS_VENTANA_CONTROL,
  diasGracia = DIAS_GRACIA_XUBIO,
  // ── La segunda prueba de que una factura salió de la app ────────────────────────
  //
  // Los números que quedaron escritos en la columna `exportado` de Ventas. FacturasEmitidas
  // es el registro del aviso de CAE y se escribe en un paso aparte que no rompe la carga si
  // falla — a propósito: la venta ya se facturó y no tiene sentido tirar todo abajo por el
  // registro. Pero entonces, si ese paso falla, la factura queda sin rastro de haber salido
  // de la app y el control la denuncia como cargada a mano.
  //
  // `exportado` se escribe en el mismo movimiento que la emisión y es lo que mira el resto
  // de los controles. Con las dos fuentes, una factura tiene que fallar en las DOS para que
  // se la acuse de manual.
  numerosEnVentas: Iterable<any> = [],
  // Las ventas de la app, para poder decir si la factura huérfana se corresponde con una
  // venta cargada a la que le falta el número. Solo informativo: no cambia ningún estado.
  ventasApp: { cliente: string; fecha: string; exportado: string }[] = [],
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

  // ── Qué números salió de la app, sin ventana ──────────────────────────────────────
  //
  // Antes este conjunto se llenaba SOLO con las emitidas dentro de la ventana, porque se
  // armaba en el mismo bucle que las revisa. Entonces una factura emitida hace nueve días
  // pero con fecha de comprobante de anteayer no figuraba como "de la app" y salía listada
  // como cargada a mano. La ventana decide qué se revisa, no qué sabemos.
  const numerosDeLaApp = new Set<string>();
  for (const e of emitidas || []) {
    const n = clave(e.numero);
    if (n) numerosDeLaApp.add(n);
  }
  for (const n of numerosEnVentas) {
    const k = clave(n);
    if (k) numerosDeLaApp.add(k);
  }

  for (const e of emitidas || []) {
    const f = soloDia(e.fecha_emision);
    if (!f || f < desde || f > hoy) continue;
    const n = clave(e.numero);
    if (!n) continue;
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
    const nombreCliente = String(c?.cliente?.nombre || c?.cliente || '').trim();
    soloEnXubio.push({
      numero: String(c?.numeroDocumento || ''),
      cliente: nombreCliente,
      fechaEmision: f,
      diasDesdeEmision: diasEntre(f, hoy),
      estado: 'solo_en_xubio',
      importeXubio: Math.round(Number(c?.importetotal) || 0),
      ventaSinNumero: ventaSinNumeroCerca(ventasApp, nombreCliente, f),
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


// ── ¿Hay una venta cargada de ese cliente, sin número de factura, por esos días? ──────
//
// El nombre se compara normalizado porque de un lado viene la razón social de Xubio y del
// otro lo que quedó escrito en la venta, y rara vez están escritos igual.
//
// Se busca la venta sin número MÁS CERCANA, sin exigir que sea de esos días.
//
// Al principio la ventana eran 4 días, por el corrimiento normal entre entrega y factura.
// Pero el caso real que hizo falta explicar fue otro: una venta de agosto facturada en
// noviembre. Con la ventana corta, esa factura aparecía como "la app nunca la tuvo" cuando
// en realidad la tenía hace tres meses esperando. Se informa la distancia en días y que
// decida quien lee: una de ayer y una de hace tres meses significan cosas distintas, pero
// las dos son una pista y ninguna es una conclusión.
const DIAS_CERCA = 400;

const normNombre = (x: any) => String(x || '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

function ventaSinNumeroCerca(
  ventas: { cliente: string; fecha: string; exportado: string }[],
  cliente: string,
  fecha: string,
): { fecha: string; cliente: string; dias: number } | undefined {
  const k = normNombre(cliente);
  if (!k) return undefined;
  let mejor: { fecha: string; cliente: string; dias: number } | undefined;
  for (const v of ventas || []) {
    const exp = String(v.exportado || '').trim();
    if (exp && exp !== 'PENDIENTE') continue;
    const vk = normNombre(v.cliente);
    if (!vk || (vk !== k && !vk.includes(k) && !k.includes(vk))) continue;
    const f = soloDia(v.fecha);
    if (!f) continue;
    const dias = Math.abs(diasEntre(f, fecha));
    if (dias > DIAS_CERCA) continue;
    if (!mejor || dias < mejor.dias) mejor = { fecha: f, cliente: String(v.cliente || ''), dias };
  }
  return mejor;
}
