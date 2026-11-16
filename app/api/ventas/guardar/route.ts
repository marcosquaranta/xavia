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
import { emitirNCPorCorreccion } from '@/lib/notaCredito';
import { emitirFacturaPorCorreccion } from '@/lib/facturaCorreccion';
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
    const { fecha, lineas, id_exportacion, importeManual, sinXubio} = await req.json();
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

    const ajustes: { numero: string; de: number; a: number; manual?: boolean; notaCredito?: string; importeNC?: number; facturaExtra?: string; importeExtra?: number }[] = [];
    // Las NC que no se pudieron emitir. Se informan a la pantalla: la corrección quedó
    // guardada igual, pero quien la hizo tiene que saber que la factura no se cerró.
    const notasFallidas: { numero: string; error: string }[] = [];
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

      // ── Qué se dio de baja de cada factura ─────────────────────────────────────
      //
      // `ventas` es la foto de ANTES de guardar y `ventasAhora` la de después: la
      // diferencia por artículo es exactamente lo que hay que acreditar. Se calcula acá,
      // con las dos fotos a mano, porque después ya no hay forma de saber qué había.
      //
      // Solo las BAJAS. Si una cantidad subió, no entra: una nota de crédito no puede
      // cobrar de más, eso necesita otro comprobante y no se decide solo.
      const antesPorVenta = new Map(ventas.map((v) => [String(v.id_venta), v]));
      const bajasPorFactura = new Map<string, { id_venta: string; key: string; cantidad: number }[]>();
      // Y lo que SUBIO. Si la correccion agrega mercaderia, no va una nota de debito: va
      // otra factura por la diferencia (decision de Marcos, ver lib/facturaCorreccion.ts).
      const altasPorFactura = new Map<string, { id_venta: string; key: string; cantidad: number }[]>();
      for (const vAhora of ventasAhora) {
        const exp = String(vAhora.exportado || '').trim();
        if (!exp || exp === 'PENDIENTE' || !numeros.has(exp)) continue;
        const vAntes = antesPorVenta.get(String(vAhora.id_venta));
        if (!vAntes) continue;
        for (const k of clavesAjuste) {
          const delta = (Number((vAhora as any)[k]) || 0) - (Number((vAntes as any)[k]) || 0);
          if (delta === 0) continue;
          const mapa = delta < 0 ? bajasPorFactura : altasPorFactura;
          const lista = mapa.get(exp) || [];
          lista.push({ id_venta: String(vAhora.id_venta), key: k, cantidad: Math.abs(delta) });
          mapa.set(exp, lista);
        }
      }

      for (const numero of numeros) {
        const v = valorDeFactura(numero, ventasAhora, precios, clientes, clavesAjuste);
        if (!v.filas) continue;
        const comp = cache.find((c) => claveComprobante(c.numero) === claveComprobante(numero));
        const importeXubio = Math.round(Number(comp?.importe) || 0);
        // ── Si la factura todavía no está en Xubio, no se corrige nada allá ─────────
        //
        // Sin el comprobante en la copia local no hay contra qué comparar: anotar un ajuste
        // con "antes = 0" diría que la factura entera cambió, que es peor que no anotar nada.
        // Y sin eso tampoco se emite nota de crédito ni factura por la diferencia: no se
        // puede corregir en Xubio algo que Xubio todavía no tiene.
        //
        // Pasa en dos situaciones distintas y conviene distinguirlas: una venta marcada
        // PENDIENTE (ya filtrada arriba, nunca llega acá) y una factura emitida hace un rato
        // que la copia local de Xubio todavía no trajo. En la segunda, la corrección quedó
        // bien guardada en la app pero el comprobante sigue diciendo lo viejo, y eso hay que
        // decirlo: antes se salteaba sin una palabra y nadie se enteraba de que faltaba algo.
        if (importeXubio <= 0) {
          notasFallidas.push({
            numero,
            error: 'esa factura todavía no figura en la copia local de Xubio, así que no se pudo corregir allá. '
              + 'Si se emitió recién, va a aparecer en la próxima sincronización y queda para resolver a mano.',
          });
          continue;
        }

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

        // ── La nota de crédito, en el acto ─────────────────────────────────────────
        //
        // Decisión de Marcos: corregir una factura ya emitida emite la NC en Xubio sola.
        // Antes quedaba un ajuste y la factura seguía diciendo el importe viejo hasta que
        // alguien se acordara de cerrarla a mano; en el primer control eran 12 facturas y
        // $1.326.755 sin cerrar.
        //
        // Va ANTES de anotar el ajuste: si la NC sale, no hace falta ajuste — la deuda ya
        // bajó en Xubio y anotar las dos cosas la bajaría dos veces. Si la NC no sale
        // —Xubio caído, un artículo sin producto equivalente, el importe puesto a mano sin
        // cantidades que lo expliquen— se anota el ajuste igual y sale en el aviso diario.
        // Nunca se pierde la corrección por no poder emitir el comprobante.
        const bajas = bajasPorFactura.get(numero) || [];
        const altas = altasPorFactura.get(numero) || [];

        // Baja el importe -> nota de credito por la diferencia.
        // `sinXubio` es la excepcion explicita: corregir lo que la app reclama y dejar el
        // comprobante como esta. Antes era el unico comportamiento; ahora hay que pedirlo,
        // porque el caso normal —la correccion de verdad— es cerrarla en Xubio.
        if (!sinXubio && manual <= 0 && bajas.length && !altas.length && monto < importeXubio) {
          const nc = await emitirNCPorCorreccion({ numeroFactura: numero, bajas, usuario: user.email })
            .catch((e: any) => ({ ok: false, error: e?.message || 'error' } as any));
          if (nc.ok) {
            ajustes.push({ numero, de: importeXubio, a: monto, notaCredito: nc.numeroNC, importeNC: nc.importe });
            continue;
          }
          notasFallidas.push({ numero, error: String((nc as any).error || 'no se pudo emitir') });
        }

        // ── Sube el importe: otra factura, no una nota de debito ────────────────────
        //
        // Es mercaderia que se entrego y no estaba facturada, asi que facturarla es
        // exactamente lo que paso. Y ademas entra sola a todo lo que ya funciona: aparece
        // en los comprobantes de Xubio como una factura mas, suma a la deuda del cliente,
        // y entra en el reclamo del lunes y en el control de facturacion. Una nota de
        // debito no la mira ninguno de esos caminos.
        //
        // Si la correccion sube Y baja a la vez (se cambio un articulo por otro) no se
        // emite nada solo: no es una diferencia, son dos movimientos, y partirlos en una
        // NC mas una factura es una decision contable que no se toma sin mirar.
        if (!sinXubio && manual <= 0 && altas.length && !bajas.length && monto > importeXubio) {
          const f = await emitirFacturaPorCorreccion({ numeroOriginal: numero, altas, usuario: user.email })
            .catch((e: any) => ({ ok: false, error: e?.message || 'error' } as any));
          if (f.ok) {
            ajustes.push({ numero, de: importeXubio, a: monto, facturaExtra: f.numero, importeExtra: f.importe });
            continue;
          }
          notasFallidas.push({ numero, error: `no se pudo facturar la diferencia: ${String((f as any).error || '')}` });
        }
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

    return NextResponse.json({ ok: true, ajustes, notasFallidas, avisoCobro });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
