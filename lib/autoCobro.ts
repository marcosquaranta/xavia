import { readSheet, updateRow, readConfig } from './sheets';
import { HOJA_BANDEJA, type ItemBandeja } from './bandejaCobranzas';
import { HOJA_COBROS, registrarCobro, type CobroRegistrado } from './cobros';
import { HOJA_COMPROBANTES, type ComprobanteCache, comprobantesDesdeCache } from './xubioCache';
import { claveComprobante } from './comprobantes';
import { getCuentas, getCobranzas } from './xubio';
import { nombreClienteVisible } from './clientes';
import { numerosSaldados, leerSaldadas } from './facturasSaldadas';
import { sumarDias } from './recordatoriosCobro';
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
// ARRANCA APAGADO. Mientras `auto_cobro_activo` no diga SI en Configuración, esto solo
// informa qué habría registrado. Es código que escribe en la contabilidad y que no se pudo
// probar contra los datos reales: la primera semana se mira, no se ejecuta.

export const CONFIG_ACTIVO = 'auto_cobro_activo';
export const CONFIG_REMITENTES = 'auto_cobro_remitentes';

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
  registrados: { idItem: string; idCobro: string; cliente: string; importe: number }[];
  errores: { idItem: string; cliente: string; error: string }[];
}

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const norm = (s: any) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Los remitentes cuyos avisos se pueden registrar solos. Se configuran: agregar uno es una
// decisión sobre la contabilidad, no algo que deba requerir un deploy — pero tampoco algo que
// deba pasar sin que nadie lo decida.
export function remitentesPermitidos(valor: any): string[] {
  return String(valor || '').split(/[,;\n]+/).map((x) => norm(x)).filter(Boolean);
}

export async function evaluarBandeja(): Promise<ResultadoAuto> {
  const hoy = fechaArgentinaHoy();
  const [activoRaw, remitentesRaw] = await Promise.all([
    readConfig(CONFIG_ACTIVO).catch(() => null),
    readConfig(CONFIG_REMITENTES).catch(() => null),
  ]);
  const activo = String(activoRaw || '').trim().toUpperCase() === 'SI';
  const permitidos = remitentesPermitidos(remitentesRaw);

  const [items, cobros, clientes, cacheComp, saldadasFilas] = await Promise.all([
    readSheet<ItemBandeja>(HOJA_BANDEJA).catch(() => [] as ItemBandeja[]),
    readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => [] as CobroRegistrado[]),
    readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
    readSheet<ComprobanteCache>(HOJA_COMPROBANTES).catch(() => [] as ComprobanteCache[]),
    leerSaldadas(),
  ]);

  const pendientes = items.filter((i) => String(i.estado || '').trim() === 'pendiente' && String(i.origen) === 'mail');
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
    const retencion = Math.round(num((it as any).retencion));
    const rechazar = (motivo: string) => out.rechazados.push({ idItem: String(it.id_item), cliente, importe, motivo });

    if (!permitidos.length) { rechazar('no hay remitentes habilitados para el registro automático'); continue; }
    const remitente = norm((it as any).remitente);
    if (!remitente || !permitidos.some((p) => remitente.includes(p))) {
      rechazar(`el remitente no está en la lista de los que se registran solos`); continue;
    }
    if (String((it as any).confianza || '') !== 'alta') { rechazar('la IA no quedó segura de lo que leyó'); continue; }
    if (!String(it.id_control || '').trim()) { rechazar('no se reconoció a qué cliente corresponde'); continue; }
    if (importe <= 0) { rechazar('no se pudo leer el importe'); continue; }

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

    const declarada = norm((it as any).cuenta_destino);
    const cuenta = declarada ? cuentas.find((c) => norm(c.nombre).includes(declarada) || declarada.includes(norm(c.nombre))) : null;
    if (!cuenta) { rechazar(declarada ? `no se pudo resolver la cuenta "${(it as any).cuenta_destino}"` : 'el aviso no dice a qué cuenta entró'); continue; }

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
      const r = await registrarCobro({
        idControl: c.idControl, fecha: c.fecha, importe: c.importe, cuentaId: c.cuentaId,
        comprobantes: c.comprobantes, retencion: c.retencion,
        observacion: `Registrado solo desde el aviso de pago (${c.comprobantes.join(', ')})`,
        usuario: 'automático',
      });
      if (!r.ok) { out.errores.push({ idItem: c.idItem, cliente: c.cliente, error: r.error || 'Xubio lo rechazó' }); continue; }
      await updateRow(HOJA_BANDEJA, 'id_item', c.idItem, {
        estado: 'confirmado', id_cobro: r.idCobro || '', usuario: 'automático',
        nota: `registrado solo: las facturas suman exactamente lo que dice el aviso`,
      });
      out.registrados.push({ idItem: c.idItem, idCobro: r.idCobro || '', cliente: c.cliente, importe: c.importe });
    } catch (e: any) {
      out.errores.push({ idItem: c.idItem, cliente: c.cliente, error: e?.message || 'error' });
    }
  }
  return out;
}
