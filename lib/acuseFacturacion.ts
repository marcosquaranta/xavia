// ── El acuse de lo que se mandó a facturar ───────────────────────────────────────────
//
// Al terminar una carga, la pantalla decía "se emitieron N facturas". Eso confirma que la
// app hizo el pedido, no que Xubio lo haya aceptado con la mercadería correcta — y son dos
// cosas distintas: la app pudo mandar un renglón de menos (pasó: los artículos de Admin no
// entraban), o Xubio pudo guardar otro importe.
//
// Esto arma el acuse: qué se emitió recién, con qué productos y cantidades, qué dice Xubio
// que tiene, y qué YA estaba facturado de ese mismo día de antes. Lo último importa porque
// el error más caro de esta pantalla es facturar dos veces el mismo día, y hasta ahora para
// darse cuenta había que ir a mirar el historial.

import type { VentaDia } from './types';
import { soloDifiereElIva } from './controlFacturacion';

export interface ItemAcuse { producto: string; cantidad: number; sucursal?: string }

export interface FacturaAcuse {
  cliente: string;
  sucursal?: string;
  numero?: string;
  cae?: string;
  total: number;
  items: ItemAcuse[];
  // Qué dice Xubio de esta factura. Es lo que convierte "la mandamos" en "la tiene".
  enXubio: 'confirmada' | 'no_encontrada' | 'difiere' | 'sin_verificar';
  // Cuando difiere: lo que Xubio tiene guardado, para poder mirarlo sin salir de acá.
  totalXubio?: number;
}

export interface GrupoAntes {
  cliente: string;
  comprobantes: string[];
  items: ItemAcuse[];
}

const num = (v: any) => Number(v) || 0;

// ── ¿Xubio lo tiene? ────────────────────────────────────────────────────────────────
//
// Se compara contra los comprobantes que Xubio devuelve, por número. El total es lo único
// que la lista de comprobantes expone, así que la verificación llega hasta ahí: si el total
// coincide, los renglones que lo componen coinciden en plata. No es lo mismo que comparar
// ítem por ítem, y por eso se dice "confirmada" y no "idéntica" — pero detecta el caso que
// importa, que es una factura que salió por menos de lo que se vendió.
//
// Una factura que la app cree emitida y Xubio no tiene es lo más grave que puede informar
// esto: hay mercadería entregada y sin facturar, y nadie se iba a enterar.
export function verificarEnXubio(
  emitidas: { cliente: string; sucursal?: string; numero?: string; cae?: string; total: number; items: ItemAcuse[] }[],
  comprobantesXubio: any[],
): FacturaAcuse[] {
  const porNumero = new Map<string, any>();
  for (const c of comprobantesXubio || []) {
    const n = String(c?.numeroDocumento || '').trim();
    if (n) porNumero.set(n, c);
  }

  return (emitidas || []).map((f) => {
    const base = { ...f, items: f.items || [] };
    // Sin número no hay con qué buscar: Xubio no lo devolvió, lo que ya es una señal.
    if (!f.numero) return { ...base, enXubio: 'sin_verificar' as const };
    const c = porNumero.get(String(f.numero).trim());
    if (!c) return { ...base, enXubio: 'no_encontrada' as const };
    const totalXubio = Math.round(num(c.importetotal));
    // ── El IVA no es una diferencia ───────────────────────────────────────────────
    //
    // La app valoriza NETO: el total de acá sale de precio por cantidad, sin impuesto.
    // Xubio factura con el IVA adentro. Compararlos crudos daba "Xubio tiene otro total"
    // en TODAS las facturas A, todas las veces — y un cartel de alerta que aparece
    // siempre deja de leerse justo cuando avisa algo real.
    //
    // Si la única diferencia es el impuesto, está confirmada. Se guarda igual el total de
    // Xubio para poder verlo al lado.
    if (soloDifiereElIva(f.total, totalXubio)) {
      return { ...base, enXubio: 'confirmada' as const, totalXubio };
    }
    // Un peso de diferencia es redondeo, no un error de carga.
    if (Math.abs(totalXubio - Math.round(f.total)) > 1) {
      return { ...base, enXubio: 'difiere' as const, totalXubio };
    }
    return { ...base, enXubio: 'confirmada' as const, totalXubio };
  });
}

// ── Lo que YA estaba facturado de ese día ───────────────────────────────────────────
//
// Las ventas de la misma fecha que ya tenían exportación antes de esta corrida. Se excluyen
// las que se acaban de mandar: esas son "recién", y mezclarlas haría parecer que se facturó
// el doble.
export function facturadoAntes(
  ventas: VentaDia[],
  fecha: string,
  idsRecienEnviados: Set<string>,
  nombreCliente: (idControl: string) => string,
  claves: { key: string; label: string }[],
): GrupoAntes[] {
  const porCliente = new Map<string, GrupoAntes>();
  for (const v of ventas || []) {
    if (String(v.fecha || '').split(/[T ]/)[0] !== fecha) continue;
    if (idsRecienEnviados.has(String(v.id_venta))) continue;
    const exp = String(v.exportado || '').trim();
    if (!exp) continue;  // sin exportar no es "facturado antes", es pendiente

    const id = String(v.id_control);
    const g = porCliente.get(id) || { cliente: nombreCliente(id), comprobantes: [], items: [] };
    if (!g.comprobantes.includes(exp)) g.comprobantes.push(exp);
    for (const c of claves) {
      const cant = num((v as any)[c.key]);
      if (cant <= 0) continue;
      const ya = g.items.find((i) => i.producto === c.label);
      if (ya) ya.cantidad += cant;
      else g.items.push({ producto: c.label, cantidad: cant });
    }
    porCliente.set(id, g);
  }
  return [...porCliente.values()]
    .filter((g) => g.items.length > 0)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
}
