import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, batchUpdateRows, readSheet } from '@/lib/sheets';
import type { VentaDia } from '@/lib/types';
import { KEYS_UNIDAD } from '@/lib/articulos';

import { asegurarColumnasArticulos } from '@/lib/articulosSheets';
import { avisarEntregasNuevas } from '@/lib/avisoCobroEntrega';

const DESTINATARIOS_AVISO = ['administracion@xavia.com.ar'];
import { claveComprobante } from '@/lib/comprobantes';
import { valorDeFactura, guardarAjuste } from '@/lib/ajusteFactura';
import { HOJA_COMPROBANTES, type ComprobanteCache } from '@/lib/xubioCache';
import type { PrecioVenta, ClienteVenta } from '@/lib/types';
export async function POST(req: NextRequest) {
  // Las columnas de los artículos nuevos tienen que existir antes de escribir por nombre.
  await asegurarColumnasArticulos();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
    // Plata = solo admin, igual que la pantalla. Cerrar la pantalla y dejar la API abierta
    // no cierra nada: la pantalla es una cortina, la API es la puerta.
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede ver o cambiar esto.' }, { status: 403 });
  try {
    const { fecha, lineas, id_exportacion, importeManual } = await req.json();
    const ventas = await readSheet<VentaDia>('Ventas');
    const fechaCarga = new Date().toISOString().split('T')[0];

    let nextId = ventas
      .map(v => parseInt(v.id_venta?.replace('V-', '') || '0'))
      .filter(n => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0) + 1;

    const toUpdate: Array<{ keyValue: string; updates: Record<string, any> }> = [];

    for (const l of lineas) {
      // Si la línea trae id_venta (edición puntual desde el historial de facturación),
      // apuntar directo a esa fila — necesario porque puede haber filas duplicadas con
      // la misma (fecha, cliente, sucursal), y buscar por esos campos sería ambiguo.
      // Si no, el flujo normal: con id_exportacion buscar esa fila puntual, sin
      // id_exportacion (sesión nueva) solo buscar filas no exportadas.
      const existente = l.id_venta
        ? ventas.find(v => v.id_venta === l.id_venta)
        : ventas.find(v =>
            v.fecha === fecha &&
            String(v.id_control) === String(l.id_control) &&
            v.sucursal === l.sucursal &&
            (id_exportacion ? v.exportado === id_exportacion : (!v.exportado || v.exportado === ''))
          );
      if (existente) {
        toUpdate.push({
          keyValue: existente.id_venta,
          updates: {
            // Por clave de artículo: agregar un producto no obliga a tocar este objeto, que
            // es justamente el lugar donde olvidarse hace que la venta se guarde sin él.
            ...Object.fromEntries(KEYS_UNIDAD.map((k) => [k, (l as any)[k] || 0])),
            // La bandeja de rúcula ya no se carga, pero si la fila vieja la tiene no se pisa
            // con 0: sería borrar una venta real al re-guardar cualquier otro campo.
            bandeja_rucula: (l as any).bandeja_rucula !== undefined
              ? (l as any).bandeja_rucula || 0
              : (Number((existente as any).bandeja_rucula) || 0),
            rucula_kg: l.rucula_kg || 0,
            // lechuga_kg (legacy) ya no lo manda la pantalla de Ventas — si no viene en el
            // request se preserva lo que ya estaba, para no pisar con 0 una venta por kg
            // cargada antes del split crespa/roble al re-guardar cualquier otro campo de la fila.
            lechuga_kg: l.lechuga_kg !== undefined ? l.lechuga_kg : (Number(existente.lechuga_kg) || 0),
            lechuga_kg_crespa: l.lechuga_kg_crespa || 0, lechuga_kg_roble: l.lechuga_kg_roble || 0,
            usuario: user.email, fecha_carga: fechaCarga,
          },
        });
      } else {
        // appendRowObj (por nombre de columna) en vez de appendRow posicional: evita tener
        // que llevar la cuenta exacta de la posición de cada columna en la planilla —
        // importante acá porque lechuga_kg_crespa/lechuga_kg_roble son columnas nuevas.
        await appendRowObj('Ventas', {
          id_venta: `V-${String(nextId++).padStart(5, '0')}`, fecha,
          id_control: l.id_control, nombre_cliente: l.nombre_cliente, sucursal: l.sucursal,
          ...Object.fromEntries(KEYS_UNIDAD.map((k) => [k, (l as any)[k] || 0])),
          bandeja_rucula: (l as any).bandeja_rucula || 0,
          rucula_kg: l.rucula_kg || 0, lechuga_kg: l.lechuga_kg || 0,
          lechuga_kg_crespa: l.lechuga_kg_crespa || 0, lechuga_kg_roble: l.lechuga_kg_roble || 0,
          exportado: '', usuario: user.email, fecha_carga: fechaCarga,
        });
      }
    }

    if (toUpdate.length) {
      await batchUpdateRows('Ventas', 'id_venta', toUpdate);
    }

    // ── Si lo que se corrigió ya estaba facturado, el monto a cobrar cambia ──────────
    //
    // La factura en Xubio no se toca: formalmente lo que corresponde es una nota de crédito,
    // y hasta que se emita el comprobante dice lo que dice. Pero la DEUDA es otra cosa, y
    // hasta acá seguía siendo la de la factura vieja: se le descontaban 40 rúculas al cliente
    // y la app le seguía reclamando el importe completo. Nadie lo notaba, porque el número
    // que mostraba era el de la factura — correcto como comprobante y equivocado como deuda.
    //
    // Se calcula acá y no al leer para que quede asentado CUÁNDO se decidió y quién: si se
    // recalculara en cada pantalla, el monto a cobrar cambiaría solo el día que se toque un
    // precio, meses después de la venta.
    const numeros = new Set<string>();
    for (const l of lineas) {
      const fila = l.id_venta ? ventas.find((v) => v.id_venta === l.id_venta) : null;
      const exp = String(fila?.exportado || '').trim();
      if (exp && exp !== 'PENDIENTE' && claveComprobante(exp)) numeros.add(exp);
    }

    const ajustes: { numero: string; de: number; a: number; manual?: boolean }[] = [];
    if (numeros.size) {
      // Se relee: los montos tienen que salir de lo que quedó guardado, no de lo que se
      // mandó. Si una línea no entró, el ajuste tiene que reflejar eso y no lo que se quiso.
      const [ventasAhora, precios, clientes, cache] = await Promise.all([
        readSheet<VentaDia>('Ventas'),
        readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
        readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
        readSheet<ComprobanteCache>(HOJA_COMPROBANTES).catch(() => [] as ComprobanteCache[]),
      ]);
      for (const numero of numeros) {
        const v = valorDeFactura(numero, ventasAhora, precios, clientes);
        if (!v.filas) continue;
        const comp = cache.find((c) => claveComprobante(c.numero) === claveComprobante(numero));
        const importeXubio = Math.round(Number(comp?.importe) || 0);
        // Sin el comprobante en la copia local no hay contra qué comparar: anotar un ajuste
        // con "antes = 0" diría que la factura entera cambió, que es peor que no anotar nada.
        if (importeXubio <= 0) continue;

        // ── El importe puesto a mano gana ───────────────────────────────────────────
        //
        // Revalorizar las cantidades alcanza cuando lo que cambió son las cantidades. No
        // alcanza cuando lo que se acordó con el cliente es otro PRECIO —una bonificación,
        // un precio pactado por única vez, un redondeo— porque el precio sale del catálogo y
        // el catálogo no sabe de ese acuerdo.
        //
        // Por eso se puede escribir el importe a cobrar directamente. Es un número decidido
        // por una persona: le gana a cualquier cálculo, y queda guardado con quién lo puso y
        // cuándo. Lo que NO hace es tocar Xubio ni el precio de catálogo del cliente: la
        // factura sigue diciendo lo que dice y el próximo pedido se valoriza como siempre.
        const manual = Math.round(Number(importeManual) || 0);
        const monto = manual > 0 ? manual : v.monto;
        if (monto <= 0) continue;
        if (Math.abs(monto - importeXubio) < 1) continue;
        await guardarAjuste({
          numero, id_control: v.id_control, cliente: v.cliente,
          importeXubio, importeApp: monto,
          motivo: manual > 0
            ? 'Importe a cobrar puesto a mano sobre una factura ya emitida'
            : 'Se corrigieron las cantidades de la venta después de facturar',
          usuario: user.email,
        });
        ajustes.push({ numero, de: importeXubio, a: monto, manual: manual > 0 });
      }
    }

    // ── Aviso de cobro contra entrega ───────────────────────────────────────────────
    //
    // También acá, y no solo en la carga del día: este es el otro camino por el que una
    // venta llega a la planilla. Una venta cargada mal y corregida después nunca disparaba
    // nada, y el repartidor iba sin saber que tenía que cobrar.
    //
    // No manda dos veces la misma entrega: ver lib/avisoEntregaEnviado.ts.
    let avisoCobro: { sucursal: string }[] = [];
    try {
      const guardadas = await readSheet<VentaDia>('Ventas');
      const ids = new Set(lineas.map((l: any) => String(l.id_venta || '')).filter(Boolean));
      const tocadas = guardadas.filter((v) => ids.has(String(v.id_venta)));
      const r = await avisarEntregasNuevas(tocadas.length ? tocadas : [], fecha, DESTINATARIOS_AVISO);
      avisoCobro = r.avisadas.map((e) => ({ sucursal: e.sucursal }));
    } catch (e) {
      console.error('[ventas/guardar] no se pudo mandar el aviso de cobro en entrega:', e);
    }

    return NextResponse.json({ ok: true, ajustes, avisoCobro });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
