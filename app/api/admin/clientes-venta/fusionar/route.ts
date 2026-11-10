import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, getCurrentUser } from '@/lib/auth';
import { readSheet, batchUpdateRows, deleteRow, appendRowObj } from '@/lib/sheets';
import type { ClienteVenta, VentaDia, PrecioVenta } from '@/lib/types';

export const dynamic = 'force-dynamic';

// ── Fusionar dos fichas del mismo cliente ────────────────────────────────────────────
//
// El caso real: "FORNO VIENA S. A. S." estaba cargado dos veces, una activa y una vieja
// dada de baja. Borrar la vieja no se podía —tenía ventas, y borrarla dejaría esas ventas
// apuntando a un cliente que no existe, sumando al resultado sin saber de quién son— y
// dejarla tampoco servía: la deuda aparece partida en dos, el recordatorio sale dos veces
// o ninguna, y el ranking de clientes miente.
//
// Lo que hace falta no es borrar: es MUDAR. Las ventas de la ficha vieja pasan a la que
// queda, y recién entonces la vieja queda vacía y se puede borrar.
//
// LA GUARDA QUE NO SE NEGOCIA: las dos fichas tienen que tener la MISMA razón social. Las
// facturas ya emitidas en Xubio salieron a nombre de esa razón social; si las dos fichas no
// coinciden, mudar las ventas estaría atribuyéndole a una empresa comprobantes emitidos a
// otra. Eso no es prolijidad, es un error fiscal, y no hay forma de deshacerlo.
//
// `soloVer` devuelve qué se movería sin tocar nada. Una fusión no se deshace, así que se
// mira antes.

const norm = (s: any) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/g, '');

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { desde, hacia, soloVer, borrarDespues, forzar } = await req.json();
    const idDesde = String(desde || '').trim();
    const idHacia = String(hacia || '').trim();
    if (!idDesde || !idHacia) return NextResponse.json({ error: 'Faltan las dos fichas.' }, { status: 400 });
    if (idDesde === idHacia) return NextResponse.json({ error: 'Son la misma ficha.' }, { status: 400 });

    const [clientes, ventas, precios] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'),
      readSheet<VentaDia>('Ventas'),
      readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
    ]);

    const a = clientes.find((c) => String(c.id_control) === idDesde);
    const b = clientes.find((c) => String(c.id_control) === idHacia);
    if (!a) return NextResponse.json({ error: `No existe el cliente ${idDesde}.` }, { status: 404 });
    if (!b) return NextResponse.json({ error: `No existe el cliente ${idHacia}.` }, { status: 404 });

    if (norm(a.nombre_xubio) !== norm(b.nombre_xubio)) {
      return NextResponse.json({
        error: `Las razones sociales no coinciden: "${a.nombre_xubio}" y "${b.nombre_xubio}". `
          + `Las facturas ya emitidas salieron a nombre de cada una, así que mudar las ventas le atribuiría a una empresa comprobantes emitidos a otra. `
          + `Si de verdad son el mismo cliente, primero corregí la razón social de la ficha que queda.`,
      }, { status: 409 });
    }

    const suyas = ventas.filter((v) => String(v.id_control) === idDesde);
    const facturadas = suyas.filter((v) => String(v.exportado || '').trim()).length;

    // ── La dirección de la fusión no es indistinta ──────────────────────────────────
    //
    // La ficha que QUEDA conserva todo lo suyo: sucursales, precios, mail, alias. La que se
    // va aporta solo sus ventas. Entonces fusionar al revés —mudar hacia la ficha vieja— se
    // queda con una configuración desactualizada: sucursales que ya no existen, precios de
    // hace un año, y el mail que nadie lee.
    //
    // Cuál es la vigente no es una opinión: es la que facturó más recientemente. Se calcula
    // y se frena si la dirección está invertida, porque esto no se deshace.
    const ultimaFactura = (id: string) => ventas
      .filter((v) => String(v.id_control) === id && String(v.exportado || '').trim())
      .map((v) => String(v.fecha || '').split(/[T ]/)[0])
      .filter(Boolean)
      .sort()
      .pop() || '';

    const ultDesde = ultimaFactura(idDesde);
    const ultHacia = ultimaFactura(idHacia);
    // Solo frena cuando hay con qué comparar: si una de las dos nunca facturó, no hay
    // "más reciente" y la decisión es de quien mira.
    const invertida = !!ultDesde && !!ultHacia && ultDesde > ultHacia;

    if (soloVer) {
      return NextResponse.json({
        ok: true, soloVer: true,
        desde: { id: idDesde, nombre: a.alias || a.nombre_display || a.nombre_xubio, sucursales: a.sucursales || '', ultimaFactura: ultDesde },
        hacia: { id: idHacia, nombre: b.alias || b.nombre_display || b.nombre_xubio, sucursales: b.sucursales || '', ultimaFactura: ultHacia },
        ventas: suyas.length, facturadas, invertida,
        // Cuantas listas de precios tiene cada una: decide si la fusion las copia o no,
        // y quien mira tiene que saberlo antes de confirmar.
        preciosDesde: precios.filter((x) => String(x.id_control) === idDesde).length,
        preciosHacia: precios.filter((x) => String(x.id_control) === idHacia).length,
      });
    }

    // ── La vuelta atrás ────────────────────────────────────────────────────────────
    //
    // La guarda de dirección sirve para la primera fusión. Para DESHACER una que salió
    // al revés está exactamente invertida: devolver las ventas a su ficha es, por
    // definición, mudarlas hacia la que hoy no factura. Si la guarda también frena eso,
    // el error queda sin arreglo posible desde la pantalla.
    //
    // Entonces se puede saltear, con una condición: sin borrar nada. Mudar ventas no
    // destruye nada —se vuelve a mudar y listo—; borrar la ficha sí. La combinación
    // "forzar la dirección Y borrar" es la que hizo el daño, y no se habilita.
    const salteaGuarda = !!forzar && !borrarDespues;

    if (invertida && !salteaGuarda) {
      return NextResponse.json({
        invertida: true,
        error: `La fusión está al revés. "${a.alias || a.nombre_xubio}" facturó más recientemente (${ultDesde}) que "${b.alias || b.nombre_xubio}" (${ultHacia}), `
          + `así que la ficha vigente es la primera: sus sucursales, precios y mail son los que hay que conservar. `
          + `Hacela desde "${b.alias || b.nombre_xubio}" hacia "${a.alias || a.nombre_xubio}". `
          + `Si lo que querés es justamente devolver ventas que se mudaron mal, se puede mudarlas solas sin borrar ninguna ficha.`,
      }, { status: 409 });
    }

    // Se muda también `nombre_cliente`: queda escrito en cada fila de Ventas y varias
    // pantallas lo usan como respaldo cuando el id no matchea. Dejarlo con el nombre viejo
    // haría que la misma venta figure con dos nombres según qué pantalla la mire.
    if (suyas.length) {
      await batchUpdateRows('Ventas', 'id_venta', suyas.map((v) => ({
        keyValue: String(v.id_venta),
        updates: { id_control: idHacia, nombre_cliente: b.nombre_xubio },
      })));
    }

    // La bandeja de cobranzas también apunta al cliente por id. Si no se muda, un aviso de
    // pago ya recibido queda atado a una ficha borrada.
    let bandeja = 0;
    try {
      const { HOJA_BANDEJA } = await import('@/lib/bandejaCobranzas');
      const filas = await readSheet<any>(HOJA_BANDEJA).catch(() => [] as any[]);
      const aMudar = filas.filter((f) => String(f.id_control) === idDesde);
      if (aMudar.length) {
        await batchUpdateRows(HOJA_BANDEJA, 'id_item', aMudar.map((f) => ({
          keyValue: String(f.id_item),
          updates: { id_control: idHacia, cliente: b.nombre_xubio },
        })));
        bandeja = aMudar.length;
      }
    } catch { /* la bandeja es accesoria: que falle no puede dejar la fusión a medias */ }

    // ── Los precios no se tiran ─────────────────────────────────────────────────────
    //
    // Esto ya costó una vez. La ficha que se va se borra junto con su fila de Precios, y
    // si la que queda no tenía precios cargados, el cliente se queda sin lista: la
    // pantalla de carga deja de ofrecerle artículos y la próxima factura sale en cero.
    // No hay aviso — simplemente no aparece.
    //
    // Entonces antes de borrar: si la que queda no tiene precios y la que se va sí, se
    // copian. Es el único dato de la ficha vieja que vale la pena conservar, porque sin
    // él las ventas que acabamos de mudar no se pueden volver a facturar.
    const preciosDesde = precios.filter((x) => String(x.id_control) === idDesde);
    const preciosHacia = precios.filter((x) => String(x.id_control) === idHacia);
    let preciosCopiados = 0;
    if (preciosDesde.length && !preciosHacia.length) {
      for (const fila of preciosDesde) {
        const { id_control: _i, nombre_cliente: _n, ...resto } = fila as any;
        await appendRowObj('Precios', {
          ...resto,
          id_control: idHacia,
          nombre_cliente: b.nombre_xubio,
        }).catch(() => null);
        preciosCopiados++;
      }
    }

    let borrada = false;
    if (borrarDespues && !salteaGuarda) {
      borrada = await deleteRow('Clientes', 'id_control', idDesde);
      // La fila de Precios se va con ella: el id_control se reusa al crear el próximo
      // cliente, que heredaría los precios de ésta.
      if (borrada) await deleteRow('Precios', 'id_control', idDesde).catch(() => false);
    }

    return NextResponse.json({
      ok: true, ventas: suyas.length, facturadas, bandeja, borrada, preciosCopiados,
      mensaje: `Se pasaron ${suyas.length} venta(s) de "${a.alias || a.nombre_xubio}" a "${b.alias || b.nombre_xubio}"`
        + (bandeja ? ` y ${bandeja} aviso(s) de la bandeja` : '')
        + (borrada ? '. La ficha vieja se borró.' : '.')
        + (preciosCopiados ? ` Se copiaron ${preciosCopiados} lista(s) de precios de la ficha vieja, porque la que queda no tenía cargada ninguna: revisalas antes de facturar.` : ''),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
