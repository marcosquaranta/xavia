// ── Facturas por cliente, todas de una ───────────────────────────────────────────────
//
// La bandeja pedía las facturas de a un cliente por vez, cuando se abría cada fila. Con
// diez movimientos para imputar eso son diez consultas a Xubio, cada una de varios
// segundos, justo en el momento en que la persona está esperando para decidir.
//
// Xubio devuelve los comprobantes de un período de una sola vez y sin filtrar por cliente:
// la consulta cuesta lo mismo para uno que para todos. Así que se pide una vez al abrir la
// pantalla y se reparte por cliente acá.

import { nombreClienteComprobante } from './recordatoriosCobro';
import { importeCobranza } from './xubio';
import type { ClienteVenta } from './types';
import { claveComprobante } from './comprobantes';

export interface FacturaCliente {
  numero: string;
  fecha: string;      // YYYY-MM-DD
  importe: number;
  yaCobrada: boolean; // ya entró en un cobro registrado desde la app
  // Cubierta por los cobros que el cliente tiene cargados EN XUBIO, imputando de la más
  // vieja a la más nueva. Ver el comentario de cubrirConCobrosDeXubio.
  cubierta?: boolean;
  // Dada por saldada a mano, sin movimiento en Xubio (ver facturasSaldadas.ts). Se informa
  // en vez de ocultarse: quien está imputando un cobro tiene que poder ver que alguien
  // decidió que esta factura ya estaba, y con qué criterio.
  saldadaManual: boolean;
}

const norm = (s: any) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

// `cobros` son las filas de CobrosRegistrados: de ahí sale qué facturas ya se contaron.
// ── Qué está pagado, según Xubio ─────────────────────────────────────────────────────
//
// La app solo sabe de los cobros que pasaron POR la app. Todo lo que se cobró antes de que
// existiera esta pantalla, o se cargó directo en Xubio, quedaba figurando como impago para
// siempre. Con una ventana de un año eso son cientos de facturas viejas apareciendo como
// deuda, y el listado se vuelve inservible: si todo figura impago, no dice nada.
//
// Xubio no permite saber qué factura cancela cada cobranza —el bean no tiene dónde decirlo,
// entra a la cuenta corriente como cobro a cuenta—. Lo que sí se puede leer es CUÁNTO cobró
// cada cliente. Con eso se imputa de la más vieja a la más nueva, que es como se paga en la
// práctica y como lo hace cualquier cuenta corriente.
//
// No es una certeza: es la mejor reconstrucción posible con lo que Xubio expone. Por eso se
// informa como `cubierta` y no como `yaCobrada` —que sí es un hecho, alguien la imputó— y
// por eso existe la pantalla de marcar a mano, para corregir lo que esto no acierte.
export function cubrirConCobrosDeXubio(
  facturas: FacturaCliente[], totalCobrado: number,
): FacturaCliente[] {
  let resto = Math.round(totalCobrado);
  // De la más vieja a la más nueva.
  const porFecha = [...facturas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const cubiertas = new Set<string>();
  for (const f of porFecha) {
    // Lo ya imputado desde la app no consume saldo acá: ese cobro también está en Xubio y
    // descontarlo dos veces taparía facturas que siguen impagas.
    if (f.yaCobrada) continue;
    if (resto <= 0) break;
    // Se corta en la primera que no entra entera, en vez de saltearla y seguir buscando
    // alguna más chica que sí entre. Saltear afirmaba algo bastante improbable —que el
    // cliente pagó la tercera factura pero no la segunda— y el costo del error es el peor
    // de los dos posibles: daba por cubierta una factura que hay que cobrar. Cortando, a lo
    // sumo queda alguna figurando impaga de más, que se ve y se corrige a mano.
    if (resto + 1 < Math.round(f.importe)) break;
    resto -= Math.round(f.importe);
    cubiertas.add(f.numero);
  }
  return facturas.map((f) => ({ ...f, cubierta: cubiertas.has(f.numero) }));
}

// ── Del nombre que trae el comprobante al cliente ────────────────────────────────────
//
// El nombre va en DOS pasadas, y el orden importa. Antes se recorría cliente por cliente
// probando nombre_xubio y nombre_display juntos, y el primero que llegaba se quedaba con la
// clave. Si un cliente tenía como nombre_display el nombre_xubio de OTRO —"Heroica Alto"
// mostrándose como "Heroica", por ejemplo— le robaba los comprobantes al verdadero
// "Heroica", que pasaba a figurar sin ninguna factura. Y no había forma de notarlo: uno de
// los dos se veía perfecto y el otro parecía un cliente sin actividad.
//
// Ahora primero se asignan TODOS los nombre_xubio —que es el nombre que de verdad aparece
// en el comprobante— y recién después los nombre_display, y solo si la clave quedó libre.
function indicePorNombre(clientes: ClienteVenta[]): Map<string, string> {
  const porNombre = new Map<string, string>();
  for (const cli of clientes || []) {
    const k = norm(cli.nombre_xubio);
    if (k && !porNombre.has(k)) porNombre.set(k, String(cli.id_control));
  }
  for (const cli of clientes || []) {
    const k = norm(cli.nombre_display);
    if (k && !porNombre.has(k)) porNombre.set(k, String(cli.id_control));
  }
  return porNombre;
}

export interface ColisionNombre {
  clave: string;
  gana: string;      // nombre del cliente que se queda con los comprobantes
  pierden: string[]; // los que quedan sin ninguno por culpa de la colisión
}

// Clientes distintos que comparten el mismo nombre normalizado. Es un problema de datos que
// hay que ver, no algo que la app pueda resolver sola: mientras exista, uno de los dos va a
// figurar sin facturas aunque las tenga.
export function colisionesDeNombre(clientes: ClienteVenta[]): ColisionNombre[] {
  const porClave = new Map<string, { id: string; nombre: string; esXubio: boolean }[]>();
  for (const cli of clientes || []) {
    for (const [nom, esXubio] of [[cli.nombre_xubio, true], [cli.nombre_display, false]] as const) {
      const k = norm(nom);
      if (!k) continue;
      const lista = porClave.get(k) || [];
      // El mismo cliente con los dos nombres iguales no es una colisión.
      if (!lista.some((x) => x.id === String(cli.id_control))) {
        lista.push({ id: String(cli.id_control), nombre: nombreDe(cli), esXubio });
        porClave.set(k, lista);
      }
    }
  }
  const out: ColisionNombre[] = [];
  for (const [clave, lista] of porClave) {
    if (lista.length < 2) continue;
    // Gana el que lo tiene como nombre_xubio (primera pasada del índice).
    const ganador = lista.find((x) => x.esXubio) || lista[0];
    out.push({
      clave,
      gana: ganador.nombre,
      pierden: lista.filter((x) => x.id !== ganador.id).map((x) => x.nombre),
    });
  }
  return out;
}

function nombreDe(c: ClienteVenta): string {
  return String(c.nombre_display || c.nombre_xubio || c.id_control || '').trim();
}

// `cobranzas` son las de Xubio: de ahí sale cuánto pagó cada cliente.
export function facturasPorCliente(
  comprobantes: any[], cobros: any[], clientes: ClienteVenta[], saldadas?: Set<string>,
  cobranzas?: any[],
): Record<string, FacturaCliente[]> {
  // Las facturas que la app ya imputó. No es lo mismo que "pagas" —Xubio no expone eso—
  // pero alcanza para no ofrecer dos veces la misma.
  // Por clave y no por texto literal: el mismo comprobante escrito distinto —con o sin
  // ceros a la izquierda, con espacio en vez de guion— no se reconocía, y entonces una
  // factura ya cobrada se seguía ofreciendo como si estuviera abierta.
  const yaCobradas = new Set<string>();
  for (const c of cobros || []) {
    if (String(c?.estado) === 'anulado') continue;
    for (const n of String(c?.comprobantes || '').split(',')) {
      const k = claveComprobante(n);
      if (k) yaCobradas.add(k);
    }
  }

  const porNombre = indicePorNombre(clientes);

  const out: Record<string, FacturaCliente[]> = {};
  for (const c of comprobantes || []) {
    // Solo facturas (tipo 1). Las notas de crédito no se cobran.
    if (Number(c?.tipo) !== 1) continue;
    const id = porNombre.get(norm(nombreClienteComprobante(c)));
    if (!id) continue;
    const numero = String(c?.numeroDocumento || '').trim();
    if (!numero) continue;
    (out[id] ||= []).push({
      numero,
      fecha: soloFecha(c?.fecha),
      importe: Number(c?.importetotal) || 0,
      yaCobrada: yaCobradas.has(claveComprobante(numero)),
      saldadaManual: !!saldadas?.has(claveComprobante(numero)),
    });
  }

  // Cuánto cobró cada cliente según Xubio, para imputar de la más vieja a la más nueva.
  const cobradoPorCliente = new Map<string, number>();
  for (const cob of cobranzas || []) {
    const id = porNombre.get(norm(nombreClienteComprobante(cob)));
    if (!id) continue;
    cobradoPorCliente.set(id, (cobradoPorCliente.get(id) || 0) + importeCobranza(cob));
  }

  // De la más reciente a la más vieja, que es como se las busca al cobrar.
  for (const id of Object.keys(out)) {
    if (cobranzas) out[id] = cubrirConCobrosDeXubio(out[id], cobradoPorCliente.get(id) || 0);
    out[id].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
  return out;
}
