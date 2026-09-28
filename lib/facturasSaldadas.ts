// ── Facturas dadas por saldadas a mano ───────────────────────────────────────────────
//
// Xubio no expone si una factura está paga: lo único que se puede leer es el total
// facturado y el total cobrado del cliente. Por eso la app deduce "pendiente" de una resta,
// y esa resta arrastra para siempre las facturas viejas que se cobraron por fuera —un
// cheque, una compensación, un cobro cargado a mano hace dos años, o simplemente algo que
// nunca se va a cobrar y se dio de baja—.
//
// El resultado práctico es ruido: facturas de hace meses que aparecen como opción al
// imputar un cobro y que se reclaman en los recordatorios. Esta hoja es la respuesta:
// decir "esta ya está, no la muestres más" SIN tocar la contabilidad.
//
// Es deliberado que no genere ningún movimiento en Xubio. Registrar un cobro falso para
// limpiar una lista ensucia la contabilidad de verdad —aparece plata que nunca entró— y es
// mucho peor que la molestia que resuelve. Esto vive solo del lado de la app, es reversible
// y queda registrado quién lo marcó y cuándo.

import { appendRowObj, asegurarHoja, readSheet, updateRow } from './sheets';
import { fechaArgentinaHoy } from './ocupacion';
import { claveComprobante } from './comprobantes';

export const HOJA_SALDADAS = 'FacturasSaldadas';
export const HEADERS_SALDADAS = [
  'numero', 'id_control', 'cliente', 'fecha_factura', 'importe',
  'fecha_marcado', 'usuario', 'motivo', 'estado',
];

export interface FacturaSaldada {
  numero: string;         // A-00002-00000849
  id_control: string;
  cliente: string;
  fecha_factura: string;
  importe: number | string;
  fecha_marcado: string;
  usuario: string;
  motivo: string;         // por qué se da por saldada — es lo que hace auditable la marca
  estado: 'saldada' | 'revertida' | string;
}

// Los números que están marcados hoy, como CLAVE (ver comprobantes.ts): se comparan contra
// lo que devuelve Xubio, y ahí el mismo comprobante puede venir escrito de otra forma. Las revertidas no cuentan: revertir tiene que
// devolver la factura a la lista, no dejarla escondida con otro nombre.
export function numerosSaldados(filas: FacturaSaldada[]): Set<string> {
  const out = new Set<string>();
  for (const f of filas || []) {
    if (String(f?.estado) === 'revertida') continue;
    const n = claveComprobante(f?.numero);
    if (n) out.add(n);
  }
  return out;
}

export async function leerSaldadas(): Promise<FacturaSaldada[]> {
  return readSheet<FacturaSaldada>(HOJA_SALDADAS).catch(() => []);
}

export interface PedidoSaldar {
  facturas: { numero: string; id_control?: string; cliente?: string; fecha?: string; importe?: number }[];
  motivo: string;
  usuario: string;
}

export async function marcarSaldadas(p: PedidoSaldar): Promise<{ marcadas: number; yaEstaban: number }> {
  await asegurarHoja(HOJA_SALDADAS, HEADERS_SALDADAS);
  const previas = await leerSaldadas();
  const ya = numerosSaldados(previas);
  const hoy = fechaArgentinaHoy();

  let marcadas = 0, yaEstaban = 0;
  for (const f of p.facturas) {
    const numero = String(f?.numero || '').trim();
    if (!numero) continue;
    // Marcar dos veces la misma no es un error del usuario: puede haber abierto la pantalla
    // en dos pestañas. Se cuenta y se sigue.
    if (ya.has(numero)) { yaEstaban++; continue; }
    // Una fila revertida que se vuelve a marcar se reactiva en vez de duplicarse, así la
    // hoja no acumula dos filas contradictorias para la misma factura.
    const revertida = previas.find(x => String(x.numero).trim() === numero && String(x.estado) === 'revertida');
    if (revertida) {
      await updateRow(HOJA_SALDADAS, 'numero', numero, {
        estado: 'saldada', fecha_marcado: hoy, usuario: p.usuario, motivo: p.motivo,
      });
    } else {
      await appendRowObj(HOJA_SALDADAS, {
        numero,
        id_control: String(f.id_control || ''),
        cliente: String(f.cliente || ''),
        fecha_factura: String(f.fecha || ''),
        importe: Math.round(Number(f.importe) || 0),
        fecha_marcado: hoy,
        usuario: p.usuario,
        motivo: p.motivo,
        estado: 'saldada',
      });
    }
    ya.add(numero);
    marcadas++;
  }
  return { marcadas, yaEstaban };
}

// Deshacer. Existe porque la marca se pone en lote y a ojo: sin vuelta atrás, un error de
// tilde esconde una factura que sí hay que cobrar y nadie se entera nunca más.
export async function revertirSaldada(numero: string, usuario: string): Promise<boolean> {
  const n = String(numero || '').trim();
  if (!n) return false;
  await asegurarHoja(HOJA_SALDADAS, HEADERS_SALDADAS);
  await updateRow(HOJA_SALDADAS, 'numero', n, {
    estado: 'revertida', fecha_marcado: fechaArgentinaHoy(), usuario,
  });
  return true;
}
