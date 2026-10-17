// Cobros registrados desde la app hacia Xubio. La hoja no es un duplicado de Xubio: guarda
// el `transaccionid` que devolvió Xubio, que es lo único que permite deshacer un cobro
// cargado por error (DELETE /cobranzaBean/{id}), y deja el rastro de quién lo cargó.
//
// Los cobros que se carguen directo en Xubio no aparecen acá — y está bien: esta hoja
// responde "qué hizo la app", no "cuánto cobramos". Para eso está el saldo, que sale de
// Xubio (ver calcularSaldos en recordatoriosCobro.ts).

export const HOJA_COBROS = 'CobrosRegistrados';
export const HEADERS_COBROS = [
  'id_cobro', 'fecha_registro', 'id_control', 'cliente', 'fecha', 'importe',
  'cuenta_id', 'transaccionid', 'numero_recibo', 'comprobantes', 'observacion', 'estado', 'usuario',
  'retencion',
];

export interface CobroRegistrado {
  id_cobro: string;
  fecha_registro: string;  // ISO — cuándo se cargó desde la app
  id_control: string;
  cliente: string;
  fecha: string;           // YYYY-MM-DD — fecha del cobro en Xubio
  importe: number | string;
  cuenta_id: number | string;
  transaccionid: number | string;
  numero_recibo: string;
  // Lo que el cliente retuvo. El `importe` es lo que entró a la cuenta: la factura se
  // canceló por importe + retención.
  retencion: number | string;
  // Facturas que el cobro cubre, separadas por coma. Xubio NO permite imputar por API, así
  // que esto no viaja a Xubio como imputación: queda acá para saber qué se cobró y para no
  // ofrecer dos veces la misma factura. En Xubio se refleja en la observación del recibo.
  comprobantes: string;
  observacion: string;
  estado: 'registrado' | 'anulado' | string;
  usuario: string;
}

// ── Registrar un cobro ───────────────────────────────────────────────────────────────
//
// Vive acá y no en el route porque lo usan dos pantallas: la carga manual de un cobro y la
// bandeja de cobranzas. Una copia en cada lado se desincroniza al primer cambio, y este es
// el camino que toca la contabilidad.
//
// El orden importa: primero Xubio, después el registro local. Si Xubio falla no queda una
// fila mintiendo que se registró; si falla el registro local, el cobro igual está en Xubio
// y se ve allá (mucho menos malo que al revés).

import { appendRowObj, asegurarHoja, asegurarColumna, asegurarColumnas, readSheet } from './sheets';
import { crearCobranza, getClientesXubio, matchClienteXubio, getCircuitosContables, circuitoPorDefecto, getCobranzas, getCuentas, diagnosticoCircuitos, datosMonedaDeCobranzas, plantillaInstrumento, type DatosMoneda } from './xubio';
import { fechaArgentinaHoy } from './ocupacion';
import { MEDIOS_PAGO, type ClienteVenta } from './types';

// Los últimos cuatro dígitos de un comprobante: "A-00002-00000849" → "0849". Si el texto
// no tiene la forma esperada se devuelve como vino, que es preferible a recortar a ciegas
// algo que no se entendió.
export function cortoDeComprobante(numero: string): string {
  const soloDigitos = String(numero || '').replace(/\D/g, '');
  return soloDigitos.length >= 4 ? soloDigitos.slice(-4) : String(numero || '').trim();
}

export interface PedidoCobro {
  idControl: string;
  fecha: string;          // YYYY-MM-DD
  importe: number;
  cuentaId: number;
  observacion?: string;
  comprobantes?: string[];
  usuario: string;
  // ── Lo que el cliente retuvo ──────────────────────────────────────────────────────
  //
  // `importe` es lo que ENTRÓ a la cuenta; la factura se cancela por la suma de los dos.
  //
  // En Xubio la cobranza va por el TOTAL contra la cuenta donde entró la plata, no partida en
  // dos instrumentos. Partirla es lo correcto en teoría, pero Xubio exige que la cuenta de
  // cada instrumento impacte en "disponibilidades", y una retención es un crédito fiscal: la
  // cuenta contablemente correcta es justamente la que rechaza. Hubo tres intentos y tres
  // rechazos.
  //
  // Entonces: en Xubio la factura queda cancelada entera —que es lo que importa allá, porque
  // es donde vive la cuenta corriente del cliente— y acá la diferencia se registra como un
  // GASTO con el medio de pago de esa misma cuenta. El saldo de la cuenta termina recibiendo
  // el neto, que es lo que de verdad pasó, y el monto retenido aparece en el resultado.
  //
  // El precio de esto es que el saldo CONTABLE de esa cuenta en Xubio queda alto por el monto
  // retenido. Se asume a propósito: la conciliación bancaria se hace en la app, no en Xubio,
  // y acá el número es correcto.
  retencion?: number;
}

export interface ResultadoCobro {
  ok: boolean;
  idCobro?: string;
  // El gasto que se cargó por la retención, si hubo.
  idGastoRetencion?: string;
  transaccionid?: number;
  numeroRecibo?: string;
  circuito?: string;
  error?: string;
  status?: number;
}

// Xubio contesta algunos errores en su propio idioma. Traducirlos no es cosmética: el
// mensaje crudo no dice qué hacer, y el que lo lee no tiene por qué saber qué es una
// "categoría que impacte en disponibilidades".
export function explicarErrorXubio(err: string): string {
  const e = String(err || '');
  if (/no tiene una categor[ií]a que impacte en disponibilidades/i.test(e)) {
    return 'Xubio no deja usar esa cuenta como forma de cobro. La cuenta de la retención existe, pero en el plan de cuentas de Xubio no está marcada como una cuenta por la que puede entrar un cobro. '
      + 'Se arregla en Xubio (plan de cuentas → esa cuenta → categoría), o eligiendo otra cuenta. '
      + `Mensaje de Xubio: ${e}`;
  }
  return e;
}

export async function registrarCobro(p: PedidoCobro): Promise<ResultadoCobro> {
  const idControl = String(p.idControl || '').trim();
  const fecha = String(p.fecha || '').trim();
  const importe = Number(p.importe);
  const cuentaId = Number(p.cuentaId);
  const observacion = String(p.observacion || '').trim();
  const comprobantes = (p.comprobantes || []).map(x => String(x).trim()).filter(Boolean);
  const retencion = Math.round(Number(p.retencion) || 0);

  if (!idControl) return { ok: false, error: 'Falta el cliente.', status: 400 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: 'La fecha tiene que ser válida.', status: 400 };
  if (!(importe > 0)) return { ok: false, error: 'El importe tiene que ser mayor a 0.', status: 400 };
  if (!Number.isFinite(cuentaId) || cuentaId === 0) {
    return { ok: false, error: 'Elegí en qué cuenta entró la plata.', status: 400 };
  }

  const clientes = await readSheet<ClienteVenta>('Clientes');
  const cli = clientes.find((c) => String(c.id_control) === idControl);
  if (!cli) return { ok: false, error: 'No se encontró el cliente.', status: 404 };

  const clientesXubio = await getClientesXubio();
  const clienteId = matchClienteXubio(cli.nombre_xubio || cli.nombre_display, clientesXubio);
  if (!clienteId) return { ok: false, error: `No se pudo encontrar "${cli.nombre_xubio}" en Xubio.`, status: 400 };

  // Xubio no deja imputar por API, así que las facturas van en la observación del recibo:
  // es lo más cerca de "este cobro cancela estas facturas" que se puede dejar asentado allá.
  //
  // Van solo los últimos cuatro dígitos. "A-00002-00000849" ocupa quince caracteres de los
  // cuales once son siempre iguales —la letra y el punto de venta no cambian— así que en un
  // cobro de cuatro facturas la observación se vuelve ilegible sin agregar información. Con
  // "0849" se reconoce el comprobante de un vistazo. El número completo queda igual en la
  // hoja de cobros de la app, que es donde se consulta si hace falta el dato exacto.
  const observacionXubio = comprobantes.length
    ? `${observacion ? observacion + ' — ' : ''}Cancela: ${comprobantes.map(cortoDeComprobante).join(', ')}`
    : observacion;

  // Xubio exige el circuito contable y no asume uno por defecto. Si no se consigue se corta
  // acá: Xubio lo va a rechazar igual, y su error ("El campo CircuitoContable esta vacío o
  // es nulo") no dice dónde está el problema.
  let circuitoId: string | number | undefined;
  let circuitoNombre = '';
  let circuitoError = '';
  // La moneda sale de las mismas cobranzas que se leen para el circuito: una sola consulta
  // resuelve los tres campos de moneda que Xubio exige y no asume.
  let datosMoneda: DatosMoneda = { moneda: null, cotizacion: 1, utilizaMonedaExtranjera: 0 };
  let plantilla: Record<string, any> | null = null;
  try {
    // Si el listado de circuitos no responde, se saca de las cobranzas ya cargadas: el
    // circuito que la empresa viene usando está adentro de cada una.
    const hoy = fechaArgentinaHoy();
    const d = new Date(hoy + 'T12:00:00'); d.setDate(d.getDate() - 180);
    const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cobranzasPrevias = await getCobranzas(desde, hoy).catch(() => [] as any[]);
    datosMoneda = datosMonedaDeCobranzas(cobranzasPrevias);
    plantilla = plantillaInstrumento(cobranzasPrevias, cuentaId);
    const elegido = circuitoPorDefecto(await getCircuitosContables(cobranzasPrevias));
    if (elegido) { circuitoId = elegido.id; circuitoNombre = elegido.nombre; }
    else circuitoError = 'Xubio no devolvió ningún circuito contable, ni el listado ni las cobranzas anteriores.';
  } catch (e: any) {
    circuitoError = `No se pudo leer el circuito contable de Xubio (${e?.message || 'error'}).`;
  }
  if (!circuitoId) {
    // El detalle de qué contestó Xubio va en el mensaje: sin eso no se puede distinguir un
    // endpoint deshabilitado de una empresa sin circuitos cargados, y son problemas
    // distintos con soluciones distintas.
    const detalle = await diagnosticoCircuitos().catch(() => '');
    return {
      ok: false, status: 502,
      error: `${circuitoError} Sin ese dato Xubio rechaza la cobranza. Cargá una cobranza a mano en Xubio (una sola alcanza) y la app aprende de ahí el circuito.${detalle ? ` — Xubio contestó: ${detalle}` : ''}`,
    };
  }

  // En Xubio va el TOTAL: importe que entró + lo retenido. Así la factura queda cancelada
  // entera allá y el cliente no figura debiendo el monto retenido.
  const totalCobranza = importe + retencion;
  const obsFinal = retencion > 0
    ? `${observacionXubio} — incluye $${retencion.toLocaleString('es-AR')} de retención`
    : observacionXubio;
  // Las cuentas de Xubio, para poder traducir cuentaId al medio de pago de la app cuando haya
  // que cargar el gasto de la retención.
  let cuentasConocidas: { id: number; nombre: string }[] = [];
  if (retencion > 0) {
    try {
      const d2 = new Date(fechaArgentinaHoy() + 'T12:00:00'); d2.setDate(d2.getDate() - 180);
      const desde2 = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}-${String(d2.getDate()).padStart(2, '0')}`;
      cuentasConocidas = (await getCuentas(await getCobranzas(desde2, fechaArgentinaHoy()).catch(() => []))).cuentas;
    } catch { cuentasConocidas = []; }
  }

  const r = await crearCobranza({ clienteId, fecha, importe: totalCobranza, cuentaId, observacion: obsFinal, circuitoId,
    retenciones: [],
    moneda: datosMoneda.moneda,
    cotizacion: datosMoneda.cotizacion,
    utilizaMonedaExtranjera: datosMoneda.utilizaMonedaExtranjera,
    plantilla,
  });
  if (!r.ok) return { ok: false, error: `Xubio rechazó el cobro: ${explicarErrorXubio(String(r.error || ''))}`, status: 502 };

  await asegurarHoja(HOJA_COBROS, HEADERS_COBROS);
  await asegurarColumna(HOJA_COBROS, 'comprobantes'); // la hoja puede existir sin esta columna
  await asegurarColumna(HOJA_COBROS, 'retencion');
  const previos = await readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => []);
  const seq = previos.reduce((a, c) => Math.max(a, parseInt(String(c.id_cobro).replace(/\D/g, ''), 10) || 0), 0) + 1;
  const idCobro = `CO-${String(seq).padStart(5, '0')}`;
  await appendRowObj(HOJA_COBROS, {
    id_cobro: idCobro,
    fecha_registro: new Date().toISOString(),
    id_control: idControl,
    cliente: cli.nombre_display || cli.nombre_xubio,
    fecha,
    importe: Math.round(importe),
    cuenta_id: cuentaId,
    transaccionid: r.transaccionid || '',
    numero_recibo: r.numeroRecibo || '',
    comprobantes: comprobantes.join(', '),
    retencion,
    observacion,
    estado: 'registrado',
    usuario: p.usuario,
  });
  // ── La retención, como gasto ──────────────────────────────────────────────────────
  //
  // En Xubio la cobranza entró por el total, así que de ese lado la factura está cancelada.
  // Acá hace falta la otra mitad: esa plata NO llegó a la cuenta, se la quedó AFIP.
  //
  // Se registra como un gasto con el medio de pago de la MISMA cuenta donde entró el cobro.
  // El saldo de esa cuenta termina recibiendo el neto —entró el total, salió la retención—
  // que es exactamente lo que dice el extracto del banco. Y aparece en el resultado por el
  // camino normal de los gastos, sin ninguna cañería aparte.
  //
  // Va después del cobro y en su propio try: si esto falla, el cobro ya está hecho y se ve.
  // Al revés sería un gasto sin cobro, que es un faltante inventado.
  let idGastoRetencion = '';
  if (retencion > 0) {
    try {
      await asegurarColumnas('Gastos', ['estado_pago', 'proveedor', 'vencimiento']);
      const gastos = await readSheet<{ id_gasto: string }>('Gastos').catch(() => []);
      const maxId = gastos
        .map((g) => parseInt(String(g.id_gasto).replace('GAS-', '') || '0', 10))
        .filter((n) => !isNaN(n))
        .reduce((m, n) => Math.max(m, n), 0);
      idGastoRetencion = `GAS-${String(maxId + 1).padStart(4, '0')}`;
      await appendRowObj('Gastos', {
        id_gasto: idGastoRetencion,
        fecha,
        descripcion: `Retención de ${cli.nombre_display || cli.nombre_xubio}${comprobantes.length ? ` — ${comprobantes.map(cortoDeComprobante).join(', ')}` : ''}`,
        categoria: 'retenciones_sufridas',
        monto: retencion,
        // La misma cuenta donde entró el cobro: es de ahí de donde "falta" la plata.
        medio_pago: nombreDeCuenta(cuentaId, cuentasConocidas) || '',
        usuario: p.usuario,
        fecha_carga: new Date().toISOString().split('T')[0],
        aplicado_stock: 'SI', // no es un insumo: que no aparezca como sugerencia de compra
      });
    } catch (e) {
      console.error('[cobros] el cobro se registró pero no se pudo cargar el gasto de la retención:', e);
    }
  }

  return { ok: true, idCobro, transaccionid: r.transaccionid, numeroRecibo: r.numeroRecibo, circuito: circuitoNombre, idGastoRetencion };
}

// El nombre del medio de pago de la app que corresponde a una cuenta de Xubio. El gasto de la
// retención tiene que salir de la MISMA cuenta donde entró el cobro: si saliera de otra, el
// saldo de las dos quedaría mal y la conciliación acusaría dos diferencias en vez de ninguna.
function nombreDeCuenta(cuentaId: number, cuentas: { id: number; nombre: string }[]): string {
  const x = cuentas.find((c) => Number(c.id) === Number(cuentaId));
  if (!x) return '';
  const norm = (v: any) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const k = norm(x.nombre);
  return MEDIOS_PAGO.find((m) => norm(m).includes(k) || k.includes(norm(m))) || '';
}

// ══ Un cobro que entra en varias fechas ════════════════════════════════════════════════
//
// Un cheque a 30 días, o media entrega ahora y la otra mitad el mes que viene: la factura se
// da por cobrada hoy, pero la plata entra en dos momentos. Cargarlo como un solo cobro con
// una sola fecha obliga a elegir cuál de las dos mentir, y las dos rompen algo distinto: con
// la fecha de hoy la cuenta muestra plata que todavía no está, y con la de la última parte la
// factura figura impaga hasta entonces y se le sigue reclamando al cliente.
//
// Así que se registran N cobros, uno por fecha, cada uno con su importe. Cada parte entra a la
// cuenta el día que de verdad entra, y las facturas quedan imputadas desde la primera.
//
// Las facturas van en TODAS las partes a propósito: la imputación marca qué cobro explica cada
// factura (la primera gana, ver imputacionesManuales) y además saca esa plata del pool de
// dinero sin explicar. Si las partes siguientes no las llevaran, su plata aparecería como un
// cobro suelto sin imputar, que es justo el problema que esto viene a evitar.
//
// La retención entra entera en la PRIMERA parte: es un hecho del momento en que se emite el
// pago, no algo que se vaya devengando con cada cheque.
export interface ParteCobro { fecha: string; importe: number }

export interface ResultadoCobroPartes {
  ok: boolean;
  partes: ResultadoCobro[];
  error?: string;
  status?: number;
}

export async function registrarCobroEnPartes(
  p: Omit<PedidoCobro, 'fecha' | 'importe'>, partes: ParteCobro[],
): Promise<ResultadoCobroPartes> {
  const limpias = (partes || [])
    .map((x) => ({ fecha: String(x?.fecha || '').trim(), importe: Math.round((Number(x?.importe) || 0) * 100) / 100 }))
    .filter((x) => x.fecha || x.importe);

  if (limpias.length < 2) return { ok: false, partes: [], error: 'Un cobro en partes necesita al menos dos fechas.', status: 400 };
  for (const x of limpias) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.fecha)) return { ok: false, partes: [], error: `La fecha "${x.fecha}" no es válida.`, status: 400 };
    if (!(x.importe > 0)) return { ok: false, partes: [], error: 'Cada parte tiene que tener un importe mayor a 0.', status: 400 };
  }

  // Se registran de la más vieja a la más nueva: así el recibo con la imputación de las
  // facturas es el primero, que es el que alguien busca cuando quiere saber desde cuándo esa
  // factura está dada por cobrada.
  limpias.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const hechas: ResultadoCobro[] = [];
  for (let i = 0; i < limpias.length; i++) {
    const parte = limpias[i];
    const etiqueta = `Parte ${i + 1} de ${limpias.length}`;
    const r = await registrarCobro({
      ...p,
      fecha: parte.fecha,
      importe: parte.importe,
      observacion: [p.observacion, etiqueta].filter(Boolean).join(' — '),
      retencion: i === 0 ? (Number(p.retencion) || 0) : 0,
    });
    hechas.push(r);
    // Si una parte falla, se corta y se devuelve lo que SÍ se registró. Seguir con las que
    // quedan dejaría el cobro partido a la mitad sin que nadie sepa qué entró y qué no; y
    // deshacer las anteriores automáticamente sería borrar de Xubio sin que nadie lo pida.
    if (!r.ok) {
      return {
        ok: false, partes: hechas, status: r.status || 500,
        error: `${etiqueta}: ${r.error}. ${i > 0 ? `Las ${i} parte(s) anteriores SÍ quedaron registradas en Xubio — revisalas antes de reintentar, o esta plata se va a contar dos veces.` : 'No se registró ninguna parte.'}`,
      };
    }
  }
  return { ok: true, partes: hechas };
}
