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

import { appendRowObj, asegurarHoja, asegurarColumna, readSheet } from './sheets';
import { crearCobranza, getClientesXubio, matchClienteXubio, getCircuitosContables, circuitoPorDefecto, getCobranzas, diagnosticoCircuitos, datosMonedaDeCobranzas, type DatosMoneda } from './xubio';
import { fechaArgentinaHoy } from './ocupacion';
import type { ClienteVenta } from './types';

export interface PedidoCobro {
  idControl: string;
  fecha: string;          // YYYY-MM-DD
  importe: number;
  cuentaId: number;
  observacion?: string;
  comprobantes?: string[];
  usuario: string;
}

export interface ResultadoCobro {
  ok: boolean;
  idCobro?: string;
  transaccionid?: number;
  numeroRecibo?: string;
  circuito?: string;
  error?: string;
  status?: number;
}

export async function registrarCobro(p: PedidoCobro): Promise<ResultadoCobro> {
  const idControl = String(p.idControl || '').trim();
  const fecha = String(p.fecha || '').trim();
  const importe = Number(p.importe);
  const cuentaId = Number(p.cuentaId);
  const observacion = String(p.observacion || '').trim();
  const comprobantes = (p.comprobantes || []).map(x => String(x).trim()).filter(Boolean);

  if (!idControl) return { ok: false, error: 'Falta el cliente.', status: 400 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: 'La fecha tiene que ser válida.', status: 400 };
  if (!(importe > 0)) return { ok: false, error: 'El importe tiene que ser mayor a 0.', status: 400 };
  if (!(cuentaId > 0)) return { ok: false, error: 'Elegí en qué cuenta entró la plata.', status: 400 };

  const clientes = await readSheet<ClienteVenta>('Clientes');
  const cli = clientes.find((c) => String(c.id_control) === idControl);
  if (!cli) return { ok: false, error: 'No se encontró el cliente.', status: 404 };

  const clientesXubio = await getClientesXubio();
  const clienteId = matchClienteXubio(cli.nombre_xubio || cli.nombre_display, clientesXubio);
  if (!clienteId) return { ok: false, error: `No se pudo encontrar "${cli.nombre_xubio}" en Xubio.`, status: 400 };

  // Xubio no deja imputar por API, así que las facturas van en la observación del recibo:
  // es lo más cerca de "este cobro cancela estas facturas" que se puede dejar asentado allá.
  const observacionXubio = comprobantes.length
    ? `${observacion ? observacion + ' — ' : ''}Cancela: ${comprobantes.join(', ')}`
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
  try {
    // Si el listado de circuitos no responde, se saca de las cobranzas ya cargadas: el
    // circuito que la empresa viene usando está adentro de cada una.
    const hoy = fechaArgentinaHoy();
    const d = new Date(hoy + 'T12:00:00'); d.setDate(d.getDate() - 180);
    const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cobranzasPrevias = await getCobranzas(desde, hoy).catch(() => [] as any[]);
    datosMoneda = datosMonedaDeCobranzas(cobranzasPrevias);
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

  const r = await crearCobranza({ clienteId, fecha, importe, cuentaId, observacion: observacionXubio, circuitoId,
    moneda: datosMoneda.moneda,
    cotizacion: datosMoneda.cotizacion,
    utilizaMonedaExtranjera: datosMoneda.utilizaMonedaExtranjera,
  });
  if (!r.ok) return { ok: false, error: `Xubio rechazó el cobro: ${r.error}`, status: 502 };

  await asegurarHoja(HOJA_COBROS, HEADERS_COBROS);
  await asegurarColumna(HOJA_COBROS, 'comprobantes'); // la hoja puede existir sin esta columna
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
    observacion,
    estado: 'registrado',
    usuario: p.usuario,
  });
  return { ok: true, idCobro, transaccionid: r.transaccionid, numeroRecibo: r.numeroRecibo, circuito: circuitoNombre };
}
