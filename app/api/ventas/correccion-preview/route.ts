import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { valorDeVenta } from '@/lib/controlFacturacion';
import { clavesDeVenta } from '@/lib/clavesVenta';
import { claveComprobante } from '@/lib/comprobantes';
import { HOJA_COMPROBANTES, type ComprobanteCache } from '@/lib/xubioCache';
import { precioFinal } from '@/lib/estadisticasVentas';
import { leerArticulosExtra } from '@/lib/articulosVenta';
import { LABELS } from '@/lib/articulos';
import type { VentaDia, PrecioVenta, ClienteVenta } from '@/lib/types';

export const dynamic = 'force-dynamic';

// ── Qué va a pasar en Xubio si guardo esto ───────────────────────────────────────────
//
// Corregir las cantidades de una factura ya emitida dispara un comprobante: una nota de
// crédito si el importe baja, una factura nueva si sube. Eso se emite en AFIP y no se
// deshace, así que no puede ser una sorpresa al apretar Guardar.
//
// Esto calcula lo mismo que hará el guardado, sin escribir nada: qué artículos bajaron,
// cuáles subieron, cuánto da cada cosa y qué comprobante saldría. La pantalla lo muestra
// mientras se tipea, y recién entonces se guarda.
//
// Es un cálculo repetido a propósito: una vista previa que use otro camino que el que
// escribe termina mostrando una cosa y haciendo otra, y en algo que se emite en AFIP eso
// es peor que no mostrar nada. Los dos salen de `valorDeVenta` y de la misma copia de los
// comprobantes de Xubio.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });
  try {
    const { lineas, importeManual } = await req.json();
    if (!Array.isArray(lineas) || !lineas.length) return NextResponse.json({ error: 'sin_lineas' }, { status: 400 });

    const claves = await clavesDeVenta();
    const [ventas, precios, clientes, cache, extras] = await Promise.all([
      readSheet<VentaDia>('Ventas'),
      readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
      readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
      readSheet<ComprobanteCache>(HOJA_COMPROBANTES).catch(() => [] as ComprobanteCache[]),
      leerArticulosExtra().catch(() => []),
    ]);

    // El nombre de cada articulo, incluidos los dados de alta desde Admin: "lechuga kg
    // crespa" en un aviso de plata se lee peor que "Crespa kg".
    const etiqueta: Record<string, string> = { ...LABELS };
    for (const a of extras) if (a.key) etiqueta[a.key] = a.label || a.key;

    const porId = new Map(ventas.map((v) => [String(v.id_venta), v]));
    // Agrupado por el comprobante de cada venta: una edición puede tocar varias facturas.
    const porFactura = new Map<string, { bajas: any[]; altas: any[]; montoNuevo: number; cliente: string }>();

    for (const l of lineas) {
      const actual = porId.get(String(l.id_venta));
      if (!actual) continue;
      const exp = String(actual.exportado || '').trim();
      if (!exp || exp === 'PENDIENTE') continue;

      const g = porFactura.get(exp) || { bajas: [], altas: [], montoNuevo: 0, cliente: String(actual.nombre_cliente || '') };
      const cli = clientes.find((c) => String(c.id_control) === String(actual.id_control));

      for (const k of claves) {
        const antes = Number((actual as any)[k]) || 0;
        const ahora = Number((l as any)[k]) || 0;
        const delta = ahora - antes;
        if (delta === 0) continue;
        const precio = precioFinal(precios, String(actual.id_control), String(actual.sucursal || ''), k, cli);
        const fila = {
          key: k,
          label: etiqueta[k] || k.replace(/_/g, ' '),
          cantidad: Math.abs(delta),
          precio: Math.round(precio),
          importe: Math.round(Math.abs(delta) * precio),
          sinPrecio: !(precio > 0),
        };
        (delta < 0 ? g.bajas : g.altas).push(fila);
      }
      porFactura.set(exp, g);
    }

    // Lo que valdría cada factura después de guardar: se valoriza la fila como quedaría,
    // con la misma función que usa el informe de facturación.
    for (const [numero, g] of porFactura) {
      let monto = 0;
      for (const l of lineas) {
        const actual = porId.get(String(l.id_venta));
        if (!actual || String(actual.exportado || '').trim() !== numero) continue;
        monto += valorDeVenta({ ...actual, ...l } as VentaDia, precios, clientes, claves);
      }
      g.montoNuevo = Math.round(monto);
    }

    const manual = Math.round(Number(importeManual) || 0);
    const out = [...porFactura.entries()].map(([numero, g]) => {
      const comp = cache.find((c) => claveComprobante(c.numero) === claveComprobante(numero));
      const montoXubio = Math.round(Number(comp?.importe) || 0);
      const montoNuevo = manual > 0 ? manual : g.montoNuevo;
      const diferencia = montoNuevo - montoXubio;

      // Las mismas condiciones que aplica el guardado, para que la vista previa no
      // prometa un comprobante que después no sale.
      let accion: 'nota_credito' | 'factura_extra' | 'ninguna' = 'ninguna';
      let motivo = '';
      if (montoXubio <= 0) {
        motivo = 'Esa factura todavía no figura en la copia local de Xubio, así que no se puede corregir allá.';
      } else if (manual > 0) {
        motivo = 'Con el importe puesto a mano no se emite comprobante: no hay cantidades que expliquen la diferencia.';
      } else if (Math.abs(diferencia) < 1) {
        motivo = 'El importe no cambia.';
      } else if (g.bajas.length && g.altas.length) {
        motivo = 'Hay artículos que suben y otros que bajan: eso son dos movimientos, no una diferencia, y no se emite solo.';
      } else if (diferencia < 0 && g.bajas.length) {
        accion = 'nota_credito';
      } else if (diferencia > 0 && g.altas.length) {
        accion = 'factura_extra';
      }

      return {
        numero, cliente: g.cliente,
        montoXubio, montoNuevo, diferencia,
        bajas: g.bajas, altas: g.altas,
        accion, motivo,
        importeComprobante: Math.abs(diferencia),
        sinPrecio: [...g.bajas, ...g.altas].some((x) => x.sinPrecio),
      };
    });

    return NextResponse.json({ ok: true, facturas: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 });
  }
}
