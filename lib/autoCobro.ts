import { readSheet, updateRow, readConfig } from './sheets';
import { HOJA_BANDEJA, type ItemBandeja } from './bandejaCobranzas';
import { HOJA_COBROS, registrarCobro, type CobroRegistrado } from './cobros';
import { HOJA_COMPROBANTES, type ComprobanteCache, comprobantesDesdeCache } from './xubioCache';
import { claveComprobante } from './comprobantes';
import { getCuentas, getCobranzas } from './xubio';
import { nombreClienteVisible } from './clientes';
import { numerosSaldados, leerSaldadas } from './facturasSaldadas';
import { sumarDias } from './recordatoriosCobro';
import { extraerCuentaDeclarada } from './cuentasCobro';
import { fechaArgentinaHoy } from './ocupacion';
import type { ClienteVenta } from './types';

// ── Registrar un cobro sin que nadie lo confirme ──────────────────────────────────────
//
// La bandeja existe porque un aviso de pago es texto escrito por un tercero que llega a un
// endpoint público, y nada de lo que diga ese texto puede mover plata sin que una persona lo
// mire. Esa regla sigue en pie y no se toca.
//
// Lo que cambia es que hay un caso en el que no hay NADA que mirar: cuando la orden de pago
// nombra las facturas y esas facturas, abiertas y de ese cliente, suman exactamente lo que
// dice que pagó. Ahí no se está confiando en el mail: se está verificando una identidad
// aritmética contra datos propios. Si el total no da, no se registra — y no da en cuanto el
// mail miente, en cuanto la IA leyó mal un número, o en cuanto una de las facturas no existe.
//
// Todo lo demás —el cliente que no matchea, la confianza media, la cuenta que no resuelve, el
// remitente desconocido— sigue yendo a la bandeja como hasta ahora. La automatización no
// reemplaza el criterio: se queda con los casos donde el criterio no aporta nada.
//
// Está PRENDIDO, por decisión de Marcos. El freno de mano es `auto_cobro_activo = NO` en
// Configuración: con eso vuelve a solo informar qué habría registrado, sin tocar nada.
//
// Que esté prendido no afloja ninguna verificación. Lo que se automatiza es el acto de
// apretar el botón sobre los casos que ya no requerían criterio; todo lo que no pasa la
// aritmética sigue yendo a la bandeja.

export const CONFIG_ACTIVO = 'auto_cobro_activo';
export const CONFIG_EXCLUIDOS = 'auto_cobro_remitentes_excluidos';
// Tope opcional: por encima de este importe no se registra solo, va a la bandeja. Vacío o 0
// = sin tope. Existe para poder poner un freno sin apagar todo, el día que haga falta.
export const CONFIG_TOPE = 'auto_cobro_tope';

// Cuánto pueden diferir la suma de las facturas y lo que dice la orden. Un peso de redondeo
// entre el total de la orden y la suma de los comprobantes es normal; mil pesos ya no es un
// redondeo, es otra factura.
export const TOLERANCIA = 2;

export interface Candidato {
  idItem: string;
  cliente: string;
  idControl: string;
  fecha: string;
  importe: number;
  retencion: number;
  comprobantes: string[];
  cuentaId: number;
  cuentaNombre: string;
  // La suma de las facturas nombradas, que tiene que dar importe + retención.
  sumaFacturas: number;
}

export interface Rechazo {
  idItem: string;
  cliente: string;
  importe: number;
  motivo: string;
}

export interface ResultadoAuto {
  activo: boolean;
  candidatos: Candidato[];
  rechazados: Rechazo[];
  // Lo imputado, con todo el detalle: el mail de confirmación tiene que poder leerse sin
  // entrar a la app. Un "se registraron 3 cobros" obliga a ir a mirar qué fueron, que es
  // exactamente el trabajo que esto venía a sacar.
  registrados: {
    idItem: string; idCobro: string; cliente: string; importe: number;
    retencion: number; comprobantes: string[]; cuentaNombre: string; fecha: string;
    numeroRecibo: string;
    // Se registró SIN mandarle la retención a Xubio, porque Xubio no acepta esa cuenta como
    // forma de cobro. Hay que decirlo: en Xubio esa factura queda abierta por el monto
    // retenido, aunque acá figure cancelada.
    retencionSoloLocal?: boolean;
  }[];
  errores: { idItem: string; cliente: string; error: string }[];
}

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const norm = (s: any) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ── Puente para las filas anteriores a las columnas ───────────────────────────────────
//
// `retencion`, `cuenta_destino` y `confianza` son columnas nuevas. Las filas que entraron a la
// bandeja antes de que existieran las tienen vacías, y los datos están igual: escritos adentro
// de la descripción, que es donde vivían hasta ahora.
//
// Sin esto, todo aviso que ya estaba en la bandeja queda rechazado por "la IA no quedó segura"
// cuando en realidad sí lo estaba, y hay que imputarlo a mano sin entender por qué.
//
// No es parsear texto ajeno: ese texto lo arma la app (ver bandejaMail.ts) con un formato que
// conocemos. Igual se usa SOLO cuando la columna está vacía — la columna siempre gana.
function confianzaDe(it: any): string {
  const col = String(it?.confianza || '').trim();
  if (col) return col;
  const m2 = String(it?.descripcion || '').match(/confianza\s+(alta|media|baja)/i);
  return m2 ? m2[1].toLowerCase() : '';
}

function retencionDe(it: any): number {
  const col = Number(it?.retencion);
  if (isFinite(col) && col > 0) return Math.round(col);
  const m2 = String(it?.descripcion || '').match(/retenci[oó]n\s+([\d.,]+)/i);
  if (!m2) return 0;
  const n = Number(String(m2[1]).replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? Math.round(n) : 0;
}

// Remitentes que NUNCA se registran solos, por más que las cuentas den.
//
// Al revés de como empezó: ya no hay lista de habilitados. Cualquier cliente que mande una
// orden de pago con las facturas y el importe entra por el mismo camino — era lo que faltaba
// para que esto sirviera de verdad, porque no son solo dos los que mandan avisos completos.
//
// Lo que habilita el registro no es quién manda el mail: es que las facturas nombradas,
// abiertas y de ese cliente, sumen al peso lo que el aviso declara. Esa verificación no
// depende del remitente, y un remitente habilitado que mandara un número mal tampoco pasaría.
//
// La lista queda, invertida, por si algún día hay que excluir a alguno:
// `auto_cobro_remitentes_excluidos` en Configuración.
export function remitentesExcluidos(valor: any): string[] {
  return String(valor || '').split(/[,;\n]+/).map((x) => norm(x)).filter(Boolean);
}

// `soloItem` evalúa una sola fila, para correr esto en el momento en que el aviso llega en
// vez de esperar al cron del día siguiente. Un cobro que se imputa 20 horas después igual se
// imputa, pero mientras tanto aparece en la bandeja como pendiente y alguien lo hace a mano —
// o peor, lo imputa dos veces.
export async function evaluarBandeja(opciones: { soloItem?: string } = {}): Promise<ResultadoAuto> {
  const hoy = fechaArgentinaHoy();
  const [activoRaw, excluidosRaw, topeRaw] = await Promise.all([
    readConfig(CONFIG_ACTIVO).catch(() => null),
    readConfig(CONFIG_EXCLUIDOS).catch(() => null),
    readConfig(CONFIG_TOPE).catch(() => null),
  ]);
  // Prendido salvo que digan explícitamente que no. Al revés —apagado hasta que alguien
  // escriba SI— significa que una clave mal tipeada deja la automatización muerta sin que
  // nada avise, y eso se descubre un mes después.
  const activo = String(activoRaw || '').trim().toUpperCase() !== 'NO';
  const excluidos = remitentesExcluidos(excluidosRaw);
  const tope = Math.max(0, Number(topeRaw) || 0);

  const [items, cobros, clientes, cacheComp, saldadasFilas] = await Promise.all([
    readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => [] as ItemBandeja[]),
    readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => [] as CobroRegistrado[]),
    readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
    readSheet<ComprobanteCache>(HOJA_COMPROBANTES).catch(() => [] as ComprobanteCache[]),
    leerSaldadas(),
  ]);

  const pendientes = items
    .filter((i) => String(i.estado || '').trim() === 'pendiente' && String(i.origen) === 'mail')
    .filter((i) => !opciones.soloItem || String(i.id_item) === String(opciones.soloItem));
  const out: ResultadoAuto = { activo, candidatos: [], rechazados: [], registrados: [], errores: [] };
  if (!pendientes.length) return out;

  // Las facturas del último año, por clave, con su cliente y su importe.
  const comprobantes = comprobantesDesdeCache(cacheComp, sumarDias(hoy, -365), hoy);
  const facturas = new Map<string, { cliente: string; importe: number }>();
  for (const c of comprobantes) {
    if (Number(c?.tipo) !== 1) continue;
    const k = claveComprobante(c?.numeroDocumento);
    if (k) facturas.set(k, { cliente: String(c?.cliente?.nombre || ''), importe: num(c?.importetotal) });
  }

  // Lo ya imputado desde la app y lo dado por saldado: una factura que ya está cobrada no
  // puede volver a entrar en un cobro automático.
  const yaCobradas = new Set<string>(numerosSaldados(saldadasFilas));
  for (const c of cobros) {
    if (String(c.estado) === 'anulado') continue;
    for (const n of String(c.comprobantes || '').split(',')) {
      const k = claveComprobante(n);
      if (k) yaCobradas.add(k);
    }
  }

  // Las cuentas de Xubio, para resolver la que declara el aviso. Una sola consulta.
  let cuentas: { id: number; nombre: string }[] = [];
  try {
    cuentas = (await getCuentas(await getCobranzas(sumarDias(hoy, -120), hoy).catch(() => []))).cuentas;
  } catch { cuentas = []; }

  for (const it of pendientes) {
    const cliente = String(it.cliente || '') || String(it.id_control || '');
    const importe = Math.round(num(it.importe));
    const retencion = retencionDe(it);
    const rechazar = (motivo: string) => out.rechazados.push({ idItem: String(it.id_item), cliente, importe, motivo });

    const remitente = norm((it as any).remitente);
    if (remitente && excluidos.some((x) => remitente.includes(x))) {
      rechazar('el remitente está excluido del registro automático'); continue;
    }
    const conf = confianzaDe(it);
    if (conf !== 'alta') {
      rechazar(conf ? `la IA leyó el aviso con confianza ${conf}` : 'no consta que la IA haya podido leer el aviso con seguridad');
      continue;
    }
    if (!String(it.id_control || '').trim()) { rechazar('no se reconoció a qué cliente corresponde'); continue; }
    if (importe <= 0) { rechazar('no se pudo leer el importe'); continue; }
    if (tope > 0 && importe > tope) {
      rechazar(`supera el tope de $${tope.toLocaleString('es-AR')} para registrarse solo`); continue;
    }

    const nums = String(it.comprobantes || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!nums.length) { rechazar('el aviso no nombra las facturas que paga'); continue; }

    // ── La verificación que habilita todo esto ────────────────────────────────────────
    //
    // Cada factura nombrada tiene que existir, ser de ESTE cliente, estar abierta, y entre
    // todas tienen que sumar lo que la orden dice que pagó más lo retenido. Si eso da, no
    // hay nada que interpretar. Si no da, no se registra: no se "ajusta" ni se aproxima.
    const cli = clientes.find((c) => String(c.id_control) === String(it.id_control));
    const nombreXubio = norm(cli?.nombre_xubio || cli?.nombre_display);
    let suma = 0;
    let problema = '';
    for (const n of nums) {
      const k = claveComprobante(n);
      const f = facturas.get(k);
      if (!f) { problema = `la factura ${n} no está en los comprobantes de Xubio`; break; }
      if (nombreXubio && norm(f.cliente) !== nombreXubio) { problema = `la factura ${n} es de ${f.cliente}, no de ${cliente}`; break; }
      if (yaCobradas.has(k)) { problema = `la factura ${n} ya figura cobrada`; break; }
      suma += f.importe;
    }
    if (problema) { rechazar(problema); continue; }
    if (Math.abs(Math.round(suma) - (importe + retencion)) > TOLERANCIA) {
      rechazar(`las facturas suman $${Math.round(suma).toLocaleString('es-AR')} y el aviso dice $${(importe + retencion).toLocaleString('es-AR')} (importe + retención)`);
      continue;
    }

    // Un cobro del mismo cliente, el mismo día y por el mismo importe ya registrado. Pasa
    // cuando el mismo aviso llega dos veces, o cuando alguien ya lo imputó a mano mientras
    // tanto. Registrarlo de nuevo duplica plata en Xubio.
    const duplicado = cobros.some((c) =>
      String(c.estado) !== 'anulado'
      && String(c.id_control) === String(it.id_control)
      && String(c.fecha).split(/[T ]/)[0] === String(it.fecha).split(/[T ]/)[0]
      && Math.abs(num(c.importe) - importe) <= TOLERANCIA);
    if (duplicado) { rechazar('ya hay un cobro registrado de ese cliente, ese día y por ese importe'); continue; }

    // La cuenta declarada: la columna, o la marca que la app deja en la descripción en las
    // filas anteriores a la columna.
    const declaradaTexto = String((it as any).cuenta_destino || '').trim() || extraerCuentaDeclarada(String(it.descripcion || ''));
    const declarada = norm(declaradaTexto);
    const cuenta = declarada ? cuentas.find((c) => norm(c.nombre).includes(declarada) || declarada.includes(norm(c.nombre))) : null;
    if (!cuenta) { rechazar(declarada ? `no se pudo resolver la cuenta "${declaradaTexto}"` : 'el aviso no dice a qué cuenta entró'); continue; }

    out.candidatos.push({
      idItem: String(it.id_item), cliente, idControl: String(it.id_control),
      fecha: String(it.fecha).split(/[T ]/)[0], importe, retencion,
      comprobantes: nums, cuentaId: cuenta.id, cuentaNombre: cuenta.nombre,
      sumaFacturas: Math.round(suma),
    });
  }

  if (!activo) return out;

  // ── Y recién acá se escribe ────────────────────────────────────────────────────────
  //
  // Mismo camino que la confirmación a mano: registrarCobro crea la cobranza en Xubio con su
  // retención y deja el rastro. Si hubiera dos caminos distintos, el automático y el manual
  // dejarían cobros con forma distinta y uno de los dos sería el raro.
  for (const c of out.candidatos) {
    try {
      const pedido = {
        idControl: c.idControl, fecha: c.fecha, importe: c.importe, cuentaId: c.cuentaId,
        comprobantes: c.comprobantes, retencion: c.retencion,
        observacion: `Registrado solo desde el aviso de pago (${c.comprobantes.join(', ')})`,
        usuario: 'automático',
      };
      let r = await registrarCobro(pedido);

      // ── Xubio no acepta la cuenta de la retención ─────────────────────────────────
      //
      // Pasa con TODO cobro que traiga retención: "la cuenta Retención Ganancias Sufrida no
      // tiene una categoría que impacte en disponibilidades". Es un problema del plan de
      // cuentas de Xubio, no del cobro, y mientras no se arregle allá ningún aviso con
      // retención se puede registrar — que son casi todos los de los supermercados.
      //
      // La pantalla ya ofrece la salida: registrar por el neto y dejar la retención anotada
      // solo acá. Acá se toma la misma, porque es una decisión que ya está tomada y repetirla
      // a mano cada vez no agrega criterio. Lo que no se puede es hacerlo en silencio: en
      // Xubio esa factura queda ABIERTA por el monto retenido, y eso se avisa en el mail.
      let soloLocal = false;
      if (!r.ok && /no tiene una categor[ií]a que impacte en disponibilidades/i.test(String(r.error || ''))) {
        r = await registrarCobro({ ...pedido, retencionSoloLocal: true });
        soloLocal = r.ok;
      }
      if (!r.ok) { out.errores.push({ idItem: c.idItem, cliente: c.cliente, error: r.error || 'Xubio lo rechazó' }); continue; }
      await updateRow(HOJA_BANDEJA, 'id_item', c.idItem, {
        estado: 'confirmado', id_cobro: r.idCobro || '', usuario: 'automático',
        nota: soloLocal
          ? 'registrado solo, SIN mandar la retención a Xubio (la cuenta no impacta en disponibilidades): allá la factura queda abierta por el monto retenido'
          : 'registrado solo: las facturas suman exactamente lo que dice el aviso',
      });
      out.registrados.push({
        idItem: c.idItem, idCobro: r.idCobro || '', cliente: c.cliente, importe: c.importe,
        retencion: c.retencion, comprobantes: c.comprobantes, cuentaNombre: c.cuentaNombre,
        fecha: c.fecha, numeroRecibo: r.numeroRecibo || '', retencionSoloLocal: soloLocal,
      });
    } catch (e: any) {
      out.errores.push({ idItem: c.idItem, cliente: c.cliente, error: e?.message || 'error' });
    }
  }
  return out;
}
