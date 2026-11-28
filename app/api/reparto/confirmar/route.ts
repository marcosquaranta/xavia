import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, batchUpdateRows, appendRowObj, asegurarHoja, asegurarColumna, filaDe } from '@/lib/sheets';
import { leerVentasConIdsUnicos } from '@/lib/ventasIds';
import type { ClienteVenta } from '@/lib/types';
import { clavesDeVenta } from '@/lib/clavesVenta';
import { entregasDelDia, claveEntrega, nuevoIdEntrega, diferenciasDe, soloDia, type LineaEntrega, type Entrega } from '@/lib/entregas';
import { leerEntregas, guardarEntrega, marcarComprobante } from '@/lib/entregasServer';
import { emitirPendientes } from '@/lib/facturacionEmitir';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Hasta cuántos días atrás se puede confirmar una entrega.
//
// Un día o dos pasa todo el tiempo: se confirma al volver al depósito, o al otro día a la
// mañana. Más de una semana ya no es una corrección de reparto, es otra conversación — y
// significaría reescribir una venta de hace dos semanas que probablemente ya se facturó.
const DIAS_ATRAS = 7;

const HEADERS_CAJONES = ['id_movimiento', 'fecha', 'id_control', 'nombre_cliente', 'sucursal', 'tipo', 'cantidad', 'usuario', 'notas', 'diferencia_paq'];

// ── Confirmar una entrega ────────────────────────────────────────────────────────────
//
// El orden importa y no es casual:
//
//   1. se guarda la entrega,
//   2. se actualiza la venta con lo que se entregó,
//   3. recién ahí se emite la factura.
//
// Si Xubio falla, la entrega ya quedó registrada. Al revés —emitir primero— una caída de
// Xubio dejaría al repartidor con la pantalla en rojo y sin rastro de lo que dijo, que es
// lo único acá que no se puede volver a averiguar.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin' && user.rol !== 'reparto') {
    return NextResponse.json({ error: 'Esta pantalla es del reparto.' }, { status: 403 });
  }
  try {
    const body = await req.json();
    const fecha = soloDia(body?.fecha);
    const idControl = String(body?.id_control || '').trim();
    const sucursal = String(body?.sucursal || '');
    const nota = String(body?.nota || '').slice(0, 300);
    const cajonesDevueltos = Math.max(0, Math.round(Number(body?.cajones_devueltos) || 0));
    if (!fecha || !idControl) return NextResponse.json({ error: 'Faltan datos de la entrega.' }, { status: 400 });

    const hoy = fechaArgentinaHoy();
    const diasAtras = Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${fecha}T12:00:00Z`)) / 86400000);
    if (!(diasAtras >= 0)) return NextResponse.json({ error: 'No se puede confirmar una entrega de una fecha futura.' }, { status: 400 });
    if (diasAtras > DIAS_ATRAS) {
      return NextResponse.json({ error: `Esa entrega es de hace ${diasAtras} días. Avisale a administración.` }, { status: 400 });
    }

    const [ventas, clientes, entregas, claves] = await Promise.all([
      leerVentasConIdsUnicos(),
      readSheet<ClienteVenta>('Clientes'),
      leerEntregas(),
      clavesDeVenta(),
    ]);

    const clave = claveEntrega(fecha, idControl, sucursal);
    const grupo = entregasDelDia(ventas, clientes, entregas, fecha, claves).find((g) => g.clave === clave);
    if (!grupo) return NextResponse.json({ error: 'Esa entrega ya no está en la lista del día.' }, { status: 404 });

    // ── Lo que dijo el repartidor, cruzado contra lo que había ──────────────────────
    //
    // Se parte de las líneas del grupo (que traen el pedido original) y solo se pisa el
    // `entregado`. El `pedido` NUNCA sale de lo que manda el celular: si viniera de ahí,
    // un bug del cliente podría borrar el único dato que prueba que hubo una diferencia.
    const entradas = new Map<string, number>();
    for (const l of (Array.isArray(body?.lineas) ? body.lineas : [])) {
      const key = String(l?.key || '');
      if (!key) continue;
      entradas.set(`${String(l?.id_venta || '')}||${key}`, Math.max(0, Number(l?.entregado) || 0));
    }

    const lineas: LineaEntrega[] = grupo.lineas.map((l) => {
      const dicho = entradas.get(`${l.id_venta}||${l.key}`);
      entradas.delete(`${l.id_venta}||${l.key}`);
      return { ...l, entregado: dicho === undefined ? l.pedido : dicho };
    });
    // Lo que dejó y no estaba en la lista. No crea una venta —cargar sigue siendo del
    // admin— pero queda registrado y sale en el mail del día.
    for (const [k, entregado] of entradas) {
      const key = k.split('||')[1];
      if (!key || !claves.includes(key) || entregado <= 0) continue;
      lineas.push({ id_venta: '', key, pedido: 0, entregado });
    }

    const entrega: Entrega = {
      id_entrega: nuevoIdEntrega(fecha),
      fecha, id_control: idControl, sucursal,
      estado: 'validada',
      validado_por: user.email,
      validado_en: new Date().toISOString(),
      lineas,
      cajones_devueltos: cajonesDevueltos,
      nota,
      comprobante: grupo.comprobante || '',
    };

    // 1. La entrega, primero y pase lo que pase.
    await guardarEntrega(entrega);

    // 2. Los cajones devueltos. Se escribe la misma hoja y con la misma forma que
    //    /api/cajones/movimiento: la pantalla de Cajones los lee sin enterarse de que
    //    vinieron de acá. `diferencia_paq` queda en 0 — es solo para los ajustes por
    //    conteo físico, y esto no es un conteo.
    if (cajonesDevueltos > 0) {
      try {
        await asegurarHoja('CajonesMovimientos', HEADERS_CAJONES);
        await asegurarColumna('CajonesMovimientos', 'sucursal');
        await appendRowObj('CajonesMovimientos', {
          id_movimiento: `CAJ-${Date.now()}`,
          fecha, id_control: idControl,
          nombre_cliente: grupo.cliente,
          sucursal,
          tipo: 'devolucion',
          cantidad: cajonesDevueltos,
          usuario: user.email,
          notas: 'Cargado desde el reparto al confirmar la entrega',
          diferencia_paq: 0,
        });
      } catch (e) {
        // Un cajón que no se pudo anotar no puede tumbar la confirmación de la entrega:
        // la entrega decide una factura, el cajón no.
        console.error('[api/reparto/confirmar] cajones:', e);
      }
    }

    // Lo que ya salió a AFIP no se toca. La entrega igual queda registrada: es lo que
    // después permite ver la diferencia y decidir si va una nota de crédito.
    if (grupo.yaFacturada) {
      return NextResponse.json({
        ok: true, estado: 'ya_facturada', comprobante: grupo.comprobante,
        diferencias: diferenciasDe(lineas),
      });
    }

    // 3. La venta pasa a decir lo que se entregó. A partir de acá, todo lo que lee ventas
    //    —estadísticas, cámara, cobranzas, el reporte— ve la realidad y no el pedido.
    const porVenta = new Map<string, Record<string, any>>();
    for (const l of lineas) {
      if (!l.id_venta) continue;
      const upd = porVenta.get(l.id_venta) || {};
      upd[l.key] = l.entregado;
      porVenta.set(l.id_venta, upd);
    }
    const filasVenta = new Map(ventas.map((v) => [String(v.id_venta), v]));
    const updates = [...porVenta.entries()].map(([idVenta, upd]) => ({
      keyValue: idVenta,
      fila: filaDe(filasVenta.get(idVenta)),
      updates: { ...upd, exportado: 'PENDIENTE' },
    }));
    if (updates.length) await batchUpdateRows('Ventas', 'id_venta', updates);

    // 4. Y recién ahora la factura, con lo que se entregó.
    const r = await emitirPendientes(null, { pares: [{ id_control: idControl, fecha }] });
    const emitida = r.emitidas[0];
    if (emitida?.numero) await marcarComprobante(entrega, String(emitida.numero));

    return NextResponse.json({
      ok: true,
      estado: emitida ? 'facturada' : 'sin_facturar',
      comprobante: emitida?.numero || '',
      // Un error de Xubio NO es un error de la confirmación: lo que dijo el repartidor ya
      // está guardado y la venta quedó en la cola. Se informa para que la pantalla lo
      // pueda decir sin asustar, y para que quede en los logs.
      error: r.errores[0]?.error || '',
      diferencias: diferenciasDe(lineas),
    });
  } catch (err: any) {
    console.error('[api/reparto/confirmar]', err);
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}
