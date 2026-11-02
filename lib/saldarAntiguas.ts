// ══ Dar por saldadas las facturas viejas, todas juntas ═══════════════════════════════
//
// Limpiar la deuda vieja se hacía cliente por cliente: elegir uno, esperar a que carguen
// sus facturas, tildar dieciocho, escribir el motivo, guardar, y empezar de nuevo con el
// siguiente. Con veinte clientes arrastrando facturas de hace un año eso es una tarde, y
// por eso no se hacía — así que la lista de impagas mostraba una deuda que no era real.
//
// Acá se calcula de una sola vez, para todos los clientes: qué sigue abierto y tiene más de
// N días. El mismo cálculo lo usan la vista previa y la marcación, a propósito. Si la
// previa contara de una forma y el botón marcara de otra, el número que se confirma no
// sería el que se escribe, y eso en una acción masiva e irreversible-a-mano es exactamente
// el error que no se puede permitir.
//
// Qué NO hace: tocar Xubio. Igual que marcar una por una, esto vive solo del lado de la
// app (ver lib/facturasSaldadas.ts). La contabilidad queda como está.

import { readSheet } from './sheets';
import { fechaArgentinaHoy } from './ocupacion';
import { sumarDias, nombreClienteComprobante } from './recordatoriosCobro';
import { HOJA_COBROS, type CobroRegistrado } from './cobros';
import { comprobantesParaMirar, cobranzasParaMirar } from './xubioLectura';
import { leerSaldadas, numerosSaldados } from './facturasSaldadas';
import { leerEdiciones, imputacionesManuales } from './cobranzasEdit';
import { leerAjustes, ajustesPorFactura } from './ajusteFactura';
import { claveComprobante } from './comprobantes';
import { facturasPorCliente, type FacturaCliente } from './facturasCliente';
import { estaImpaga } from './conciliacionCobro';
import { nombreClienteVisible } from './clientes';
import type { ClienteVenta } from './types';

// La misma ventana que la pantalla de Cobranzas. No es estético: lo que se da por cubierto
// se calcula repartiendo los cobros del cliente de la más vieja a la más nueva, y con otra
// ventana el reparto da distinto y la MISMA factura aparece abierta acá y cobrada allá.
export const DIAS_VENTANA = 365;

// Más de 60 días es el caso que Marcos describió, y los otros tres existen para poder
// empezar más conservador o barrer más hondo sin tocar el código.
export const DIAS_OPCIONES = [30, 60, 90, 120, 180] as const;

export interface FacturaAntigua {
  numero: string;
  fecha: string;
  importe: number;
  dias: number;
}

export interface ClienteAntiguas {
  id_control: string;
  cliente: string;
  facturas: FacturaAntigua[];
  total: number;
  masVieja: string;
  // Lo que queda abierto DESPUÉS de este corte. Va porque es la pregunta inmediata cuando
  // se ve "12 facturas de Andrés": ¿y lo demás? Sin esto hay que ir a otra pantalla.
  quedanAbiertas: number;
  quedanTotal: number;
}

export interface ResultadoAntiguas {
  dias: number;
  hasta: string;         // las facturas de esta fecha o anteriores son las que entran
  clientes: ClienteAntiguas[];
  totalFacturas: number;
  totalImporte: number;
}

const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

const diasEntreF = (desde: string, hasta: string) => {
  const a = new Date(desde + 'T12:00:00').getTime();
  const b = new Date(hasta + 'T12:00:00').getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : 0;
};

// ── Todo lo que sigue abierto, con más de `dias` de antigüedad ──────────────────────
//
// Lee exactamente las mismas fuentes que la pantalla de Cobranzas y usa `facturasPorCliente`
// y `estaImpaga`, que son las funciones con las que se decide qué reclamar. Repetir el
// criterio acá con un filtro propio sería crear una segunda definición de "está impaga", y
// ya costó caro tener tres.
export async function facturasAntiguas(dias: number): Promise<ResultadoAntiguas> {
  const corte = Math.max(0, Math.round(Number(dias) || 0));
  const hoy = fechaArgentinaHoy();
  const desde = sumarDias(hoy, -DIAS_VENTANA);
  // Las de esta fecha o anteriores. Con `>= corte` sobre la diferencia en días sale lo
  // mismo, pero tener la fecha explícita permite decirla en pantalla: "las emitidas hasta
  // el 3/9" se entiende de una, "las de más de 60 días" obliga a hacer la cuenta.
  const hasta = sumarDias(hoy, -corte);

  const [clientes, comps, cobros, cobranzasX, saldadasFilas, edicionesRaw, ajustesRaw] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    comprobantesParaMirar(desde, hoy),
    readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => [] as CobroRegistrado[]),
    cobranzasParaMirar(desde, hoy),
    leerSaldadas(),
    leerEdiciones(),
    leerAjustes(),
  ]);

  const todas = facturasPorCliente(
    comps, cobros, clientes, numerosSaldados(saldadasFilas), cobranzasX,
    imputacionesManuales(edicionesRaw, claveComprobante), ajustesPorFactura(ajustesRaw),
  );

  const nombres = new Map(clientes.map((c) => [String(c.id_control), nombreClienteVisible(c)]));
  const salida: ClienteAntiguas[] = [];

  for (const [id, fs] of Object.entries(todas)) {
    const abiertas = fs.filter(estaImpaga).filter((f) => Math.round(Number(f.importe) || 0) > 0);
    if (!abiertas.length) continue;
    const viejas = abiertas.filter((f) => soloFecha(f.fecha) <= hasta);
    if (!viejas.length) continue;
    const resto = abiertas.filter((f) => soloFecha(f.fecha) > hasta);
    salida.push({
      id_control: String(id),
      cliente: nombres.get(String(id)) || String(id),
      facturas: viejas
        .map((f) => ({
          numero: String(f.numero),
          fecha: soloFecha(f.fecha),
          importe: Math.round(Number(f.importe) || 0),
          dias: diasEntreF(soloFecha(f.fecha), hoy),
        }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha)),
      total: viejas.reduce((a, f) => a + Math.round(Number(f.importe) || 0), 0),
      masVieja: viejas.map((f) => soloFecha(f.fecha)).sort()[0] || '',
      quedanAbiertas: resto.length,
      quedanTotal: resto.reduce((a, f) => a + Math.round(Number(f.importe) || 0), 0),
    });
  }

  // El que más plata vieja arrastra primero: es por dónde conviene empezar y es el que
  // explica el grueso del número que aparece en la lista de impagas.
  salida.sort((a, b) => b.total - a.total || a.cliente.localeCompare(b.cliente));

  return {
    dias: corte,
    hasta,
    clientes: salida,
    totalFacturas: salida.reduce((a, c) => a + c.facturas.length, 0),
    totalImporte: salida.reduce((a, c) => a + c.total, 0),
  };
}

// Las facturas en el formato que espera `marcarSaldadas`, aplanadas. Opcionalmente acotado
// a algunos clientes: la pantalla deja destildar a alguno de la vista previa, y barrer igual
// a un cliente que se destildó a propósito sería ignorar la única decisión que se tomó.
export function paraMarcar(
  r: ResultadoAntiguas, soloEstos?: string[],
): { numero: string; id_control: string; cliente: string; fecha: string; importe: number }[] {
  const filtro = soloEstos?.length ? new Set(soloEstos.map(String)) : null;
  return r.clientes
    .filter((c) => !filtro || filtro.has(c.id_control))
    .flatMap((c) => c.facturas.map((f) => ({
      numero: f.numero,
      id_control: c.id_control,
      cliente: c.cliente,
      fecha: f.fecha,
      importe: f.importe,
    })));
}

export type FacturaClienteAbierta = FacturaCliente;
