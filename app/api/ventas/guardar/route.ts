import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowsObj, batchUpdateRows, readSheet, filaDe } from '@/lib/sheets';
import { nuevoIdVenta, leerVentasConIdsUnicos } from '@/lib/ventasIds';
import type { VentaDia } from '@/lib/types';
import { KEYS_UNIDAD } from '@/lib/articulos';

import { asegurarColumnasArticulos } from '@/lib/articulosSheets';
import { avisarEntregasNuevas } from '@/lib/avisoCobroEntrega';

const DESTINATARIOS_AVISO = ['administracion@xavia.com.ar'];
import { claveComprobante } from '@/lib/comprobantes';
import { valorDeFactura, guardarAjuste } from '@/lib/ajusteFactura';
import { HOJA_COMPROBANTES, type ComprobanteCache } from '@/lib/xubioCache';
import type { PrecioVenta, ClienteVenta } from '@/lib/types';
import { leerArticulosExtra } from '@/lib/articulosVenta';
import { clavesDeVenta } from '@/lib/clavesVenta';
export async function POST(req: NextRequest) {
  // Las columnas de los artículos nuevos tienen que existir antes de escribir por nombre.
  await asegurarColumnasArticulos();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  // Las claves de artículo incluyen las dadas de alta desde Admin. Si salieran solo del
  // código, una venta de un producto nuevo se guardaría con esa columna en blanco: la
  // pantalla la muestra cargada y la planilla queda en cero.
  const clavesUnidad = [
    ...KEYS_UNIDAD,
    ...(await leerArticulosExtra()).filter((a) => a.activo && a.unidad === 'unidad').map((a) => a.key),
  ];
    // Plata = solo admin, igual que la pantalla. Cerrar la pantalla y dejar la API abierta
    // no cierra nada: la pantalla es una cortina, la API es la puerta.
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede ver o cambiar esto.' }, { status: 403 });
  try {
    const { fecha, lineas, id_exportacion, importeManual } = await req.json();
    // Con ids únicos garantizados: si quedaron repetidos de antes, se corrigen acá.
    const ventas = await leerVentasConIdsUnicos();
    const fechaCarga = new Date().toISOString().split('T')[0];
    const soloDia = (v: any) => String(v || '').split(/[T ]/)[0];
    const sinExportar = (v: VentaDia) => !v.exportado || v.exportado === '';
    const KG = ['rucula_kg', 'lechuga_kg_crespa', 'lechuga_kg_roble'] as const;

    const toUpdate: Array<{ keyValue: string; fila?: number; updates: Record<string, any> }> = [];
    const nuevas: Record<string, any>[] = [];

    for (const l of lineas) {
      // Si la línea trae id_venta (edición puntual desde el historial de facturación),
      // apuntar directo a esa fila. Si no, el flujo normal: con id_exportacion buscar esa
      // tanda, sin id_exportacion (sesión nueva) solo filas no exportadas.
      const candidatas = l.id_venta
        ? ventas.filter(v => v.id_venta === l.id_venta).slice(0, 1)
        : ventas.filter(v =>
            soloDia(v.fecha) === fecha &&
            String(v.id_control) === String(l.id_control) &&
            String(v.sucursal || '') === String(l.sucursal || '') &&
            (id_exportacion ? v.exportado === id_exportacion : sinExportar(v))
          );
      const existente = candidatas[0];

      // ── Lo que no viene no se toca ────────────────────────────────────────────────
      //
      // La pantalla guarda de a una sección: las unidades por un lado y los cajones por
      // otro. Antes lo que no venía se guardaba en 0, así que al guardar una celda de
      // paquetes se borraban los kilos de ese cliente, y al revés. Ahora una clave ausente
      // conserva lo que había.
      const valor = (k: string, previo: any) =>
        (l as any)[k] !== undefined ? (Number((l as any)[k]) || 0) : (Number(previo) || 0);

      if (existente) {
        toUpdate.push({
          keyValue: existente.id_venta, fila: filaDe(existente),
          updates: {
            ...Object.fromEntries(clavesUnidad.map((k) => [k, valor(k, (existente as any)[k])])),
            bandeja_rucula: valor('bandeja_rucula', (existente as any).bandeja_rucula),
            lechuga_kg: valor('lechuga_kg', existente.lechuga_kg),
            ...Object.fromEntries(KG.map((k) => [k, valor(k, (existente as any)[k])])),
            usuario: user.email, fecha_carga: fechaCarga,
          },
        });
        // ── Una sola fila por cliente, sucursal y día ───────────────────────────────
        //
        // Si quedaron dos filas sin facturar para el mismo cliente, la misma sucursal y el
        // mismo día, son la misma venta guardada dos veces. La línea que llega es lo que
        // vale: va a la primera y las demás quedan en cero. Si no, las dos se facturaban.
        if (!l.id_venta && !id_exportacion) {
          for (const dup of candidatas.slice(1)) {
            toUpdate.push({
              keyValue: dup.id_venta, fila: filaDe(dup),
              updates: {
                ...Object.fromEntries(clavesUnidad.map((k) => [k, 0])),
                bandeja_rucula: 0, lechuga_kg: 0, ...Object.fromEntries(KG.map((k) => [k, 0])),
              },
            });
          }
        }
      } else {
        const fila = {
          id_venta: nuevoIdVenta(), fecha,
          id_control: l.id_control, nombre_cliente: l.nombre_cliente, sucursal: l.sucursal,
          ...Object.fromEntries(clavesUnidad.map((k) => [k, valor(k, 0)])),
          bandeja_rucula: valor('bandeja_rucula', 0),
          lechuga_kg: valor('lechuga_kg', 0),
          ...Object.fromEntries(KG.map((k) => [k, valor(k, 0)])),
          exportado: '', usuario: user.email, fecha_carga: fechaCarga,
        };
        // Una fila toda en cero no es una venta: no se crea.
        const tieneAlgo = [...clavesUnidad, 'bandeja_rucula', 'lechuga_kg', ...KG].some((k) => Number((fila as any)[k]) > 0);
        if (tieneAlgo) nuevas.push(fila);
      }
    }

    if (nuevas.length) await appendRowsObj('Ventas', nuevas);
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
      // Las mismas claves que usa el informe de facturacion. Con la lista fija del
      // codigo, una factura de lechuga por kilo valia cero y el ajuste la dejaba en cero.
      const clavesAjuste = await clavesDeVenta();
      for (const numero of numeros) {
        const v = valorDeFactura(numero, ventasAhora, precios, clientes, clavesAjuste);
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
