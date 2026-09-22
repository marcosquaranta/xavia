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
import type { ClienteVenta } from './types';

export interface FacturaCliente {
  numero: string;
  fecha: string;      // YYYY-MM-DD
  importe: number;
  yaCobrada: boolean; // ya entró en un cobro registrado desde la app
}

const norm = (s: any) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

// `cobros` son las filas de CobrosRegistrados: de ahí sale qué facturas ya se contaron.
export function facturasPorCliente(
  comprobantes: any[], cobros: any[], clientes: ClienteVenta[],
): Record<string, FacturaCliente[]> {
  // Las facturas que la app ya imputó. No es lo mismo que "pagas" —Xubio no expone eso—
  // pero alcanza para no ofrecer dos veces la misma.
  const yaCobradas = new Set<string>();
  for (const c of cobros || []) {
    if (String(c?.estado) === 'anulado') continue;
    for (const n of String(c?.comprobantes || '').split(',')) {
      const t = n.trim();
      if (t) yaCobradas.add(t);
    }
  }

  // Índice del nombre normalizado de Xubio al id_control, para no recorrer los clientes
  // por cada comprobante.
  const porNombre = new Map<string, string>();
  for (const cli of clientes || []) {
    for (const nom of [cli.nombre_xubio, cli.nombre_display]) {
      const k = norm(nom);
      if (k && !porNombre.has(k)) porNombre.set(k, String(cli.id_control));
    }
  }

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
      yaCobrada: yaCobradas.has(numero),
    });
  }

  // De la más reciente a la más vieja, que es como se las busca al cobrar.
  for (const id of Object.keys(out)) {
    out[id].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
  return out;
}
