import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, batchUpdateRows } from '@/lib/sheets';
import { emitirPendientes } from '@/lib/facturacionEmitir';
import { avisarEntregasNuevas } from '@/lib/avisoCobroEntrega';
import type { VentaDia, ClienteVenta } from '@/lib/types';
import { clavesDeVenta, tieneCantidad } from '@/lib/clavesVenta';
import { verificarEnXubio, facturadoAntes } from '@/lib/acuseFacturacion';
import { getComprobantes } from '@/lib/xubio';
import { LABELS_LARGOS } from '@/lib/articulos';
import { leerArticulosExtra } from '@/lib/articulosVenta';

// A quién le llega el aviso de "hay que cobrar en la entrega".
const DESTINATARIOS_AVISO = ['administracion@xavia.com.ar'];

// Marca las ventas borrador de una fecha como PENDIENTE y las emite DIRECTO a Xubio
// (una factura por cliente, sin pasar por la sección Facturación). Las que fallen
// (ej. cliente no encontrado en Xubio) quedan como PENDIENTE para arreglar/reintentar
// desde Facturación; el resto de ajustes se hacen con NC o directo en Xubio.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
    // Plata = solo admin, igual que la pantalla. Cerrar la pantalla y dejar la API abierta
    // no cierra nada: la pantalla es una cortina, la API es la puerta.
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede ver o cambiar esto.' }, { status: 403 });
  try {
    const { fecha } = await req.json();
    if (!fecha) return NextResponse.json({ error: 'fecha requerida' }, { status: 400 });

    const ventas = await readSheet<VentaDia>('Ventas');
    // ── Las claves salen de la hoja, no del código ──────────────────────────────────
    //
    // Esto miraba solo PROD_KEYS. Una venta de un artículo dado de alta en Admin —el berro
    // hidropónico fue el primero— tenía todas esas columnas en cero, así que el filtro no
    // la encontraba y la app contestaba "no hay ventas para cargar en esa fecha" con la
    // venta cargada y a la vista. Las ventas por kilo caían en lo mismo.
    const claves = await clavesDeVenta();
    const aCargar = ventas.filter(v =>
      v.fecha === fecha &&
      (!v.exportado || v.exportado === '') &&
      tieneCantidad(v, claves)
    );
    if (!aCargar.length) {
      // El motivo, no solo el hecho. Son tres situaciones distintas —no hay nada cargado,
      // ya se facturó todo, o hay filas pero vacías— y las tres se leían igual.
      const delDia = ventas.filter(v => v.fecha === fecha);
      const yaExportadas = delDia.filter(v => v.exportado && v.exportado !== '').length;
      const motivo = !delDia.length
        ? 'No hay ninguna venta cargada en esa fecha.'
        : yaExportadas === delDia.length
          ? `Las ${delDia.length} venta(s) de esa fecha ya se facturaron.`
          : 'Hay ventas cargadas en esa fecha pero todas están en cero: no hay mercadería que facturar.';
      return NextResponse.json({ error: motivo }, { status: 400 });
    }

    await batchUpdateRows('Ventas', 'id_venta', aCargar.map(v => ({
      keyValue: v.id_venta,
      updates: { exportado: 'PENDIENTE' },
    })));

    // readSheet convierte columnas "numéricas" (como id_control) de string a number
    // automáticamente. emitirPendientes compara contra String(v.id_control), así que
    // acá hay que forzar string también — si no, el Set nunca matchea y la emisión
    // queda vacía en silencio (sin error, sin factura).
    const idControls = Array.from(new Set(aCargar.map(v => String(v.id_control))));
    // El objeto entero, no solo cliente/numero: el acuse necesita los renglones y el total
    // para poder decir QUÉ se facturó y contrastarlo contra lo que Xubio guardó.
    let emitidas: any[] = [];
    let errores: any[] = [];
    try {
      const r = await emitirPendientes(idControls);
      emitidas = r.emitidas; errores = r.errores;
      if (errores.length) console.error('[ventas/cargar] errores al emitir a Xubio:', JSON.stringify(errores));
      // El aviso de CAEs pendientes ya NO sale acá: un día con tres cargas mandaba tres
      // mails. Las emisiones quedan registradas (ver lib/caePendientes.ts) y sale un solo
      // aviso acumulado por la mañana, desde /api/cron/cae-pendientes.
    } catch (e: any) {
      console.error('[ventas/cargar] excepción al emitir a Xubio:', e);
      errores = [{ cliente: 'Xubio', error: e?.message || 'Error al emitir' }];
    }

    // El mail de "Facturación pendiente" se sacó a pedido: el único aviso que queda es el
    // de CAEs pendientes, que ahora sale una vez por día. Los errores de emisión se
    // muestran igual en pantalla al terminar la carga, con el detalle por cliente.
    const clientes = idControls.length;
    // Aviso de cobro contra entrega. Va después de emitir y dentro de su propio try: que
    // falle un mail no puede tirar abajo una carga de ventas que ya se hizo.
    let avisoCobro: { sucursal: string }[] = [];
    try {
      const r = await avisarEntregasNuevas(aCargar, fecha, DESTINATARIOS_AVISO);
      avisoCobro = r.avisadas.map(e => ({ sucursal: e.sucursal }));
    } catch (e) {
      console.error('[ventas/cargar] no se pudo mandar el aviso de cobro en entrega:', e);
    }

    // ── El acuse ────────────────────────────────────────────────────────────────────
    //
    // "Se emitieron N facturas" confirma que la app hizo el pedido, no que Xubio lo tenga.
    // Acá se le vuelve a preguntar a Xubio y se compara: una factura que la app cree
    // emitida y Xubio no tiene es mercadería entregada y sin facturar, y hasta ahora nadie
    // se iba a enterar.
    //
    // Todo adentro de su propio try: la carga YA se hizo y las facturas YA se emitieron.
    // Que falle la verificación no puede convertir eso en un error en pantalla.
    let acuse: any = null;
    try {
      const nombrePorId = new Map(
        (await readSheet<ClienteVenta>('Clientes')).map((c) => [String(c.id_control), c.nombre_display || c.nombre_xubio || String(c.id_control)]),
      );
      const extra = await leerArticulosExtra().catch(() => []);
      const etiquetas = [
        ...Object.entries(LABELS_LARGOS).map(([key, label]) => ({ key, label })),
        ...extra.filter((a) => a.key).map((a) => ({ key: a.key, label: a.labelLargo || a.label || a.key })),
        { key: 'rucula_kg', label: 'Rúcula (kg)' },
        { key: 'lechuga_kg', label: 'Lechuga (kg)' },
        { key: 'lechuga_kg_crespa', label: 'Lechuga Crespa (kg)' },
        { key: 'lechuga_kg_roble', label: 'Lechuga Roble (kg)' },
      ];

      // La ventana es amplia porque la factura puede haber salido con otra fecha que la
      // venta (ver fechaDeFactura): buscarla solo en el día de la venta la daría por
      // perdida cuando está.
      const desde = new Date(Date.parse(`${fecha}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
      const hasta = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const comprobantes = await getComprobantes(desde, hasta).catch(() => []);

      acuse = {
        fecha,
        emitidas: verificarEnXubio(emitidas, comprobantes),
        errores,
        antes: facturadoAntes(
          ventas, fecha, new Set(aCargar.map((v) => String(v.id_venta))),
          (id) => nombrePorId.get(String(id)) || String(id),
          etiquetas,
        ),
      };
    } catch (e) {
      console.error('[ventas/cargar] no se pudo armar el acuse:', e);
    }

    return NextResponse.json({ ok: true, lineas: aCargar.length, clientes, emitidas, errores, avisoCobro, acuse });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
