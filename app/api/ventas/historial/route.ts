import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia, ClienteVenta, ConfigItem } from '@/lib/types';
import { mapaNombresClientes } from '@/lib/clientes';
import { catalogoDeVenta } from '@/lib/articulosVenta';
import { KEYS_ROLLUP, otrosDeVenta, type EntradaExpCliente, type EntradaPend } from '@/lib/historialVentas';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
    // Plata = solo admin, igual que la pantalla. Cerrar la pantalla y dejar la API abierta
    // no cierra nada: la pantalla es una cortina, la API es la puerta.
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede ver o cambiar esto.' }, { status: 403 });
  try {
    const [ventas, clientes, config, cat] = await Promise.all([
      readSheet<VentaDia>('Ventas'),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<ConfigItem>('Config'),
      // El catálogo completo, también los artículos dados de alta desde la app. Sin esto la
      // pantalla solo conoce los que están escritos en el código y los microgreens no
      // existen para ella.
      catalogoDeVenta(),
    ]);

    const clienteMap = mapaNombresClientes(clientes);
    // Todo lo que no entra en las cuatro columnas de siempre. Se arma del catálogo y no de
    // una lista escrita acá: dar de alta un artículo desde la app tiene que alcanzar para
    // que aparezca en esta pantalla, que es justamente lo que no pasaba.
    const keysOtros = cat.todos.map((a) => a.key).filter((k) => !KEYS_ROLLUP.has(k));

    const porExpCliente = new Map<string, EntradaExpCliente>();
    // Por fecha Y cliente, no solo por fecha.
    //
    // Agrupado solo por fecha, "no facturado el 18/10" no se podía resolver: había que
    // abrir la carga de ese día y mirar fila por fila de quién era. Y el caso más común
    // —que ese cliente SÍ se facturó, en otra tanda, y lo que quedó suelto es una fila
    // repetida— no se veía de ninguna manera.
    const pendientes = new Map<string, EntradaPend>();
    // Qué se facturó a cada cliente en cada fecha, para poder cruzarlo contra lo pendiente.
    const facturadoPorClienteFecha = new Map<string, { id_exportacion: string; fecha_exportacion: string }[]>();

    for (const v of ventas) {
      if (!v.fecha) continue;
      const fecha = String(v.fecha).split(/[\sT]/)[0];
      const expId = String(v.exportado || '');
      const nombre = clienteMap.get(String(v.id_control)) || String(v.id_control);
      const suc = String(v.sucursal || '').trim();

      // PENDIENTE no es "facturado": es una venta que se marcó para facturar y Xubio todavía
      // no emitió (falló, o quedó a mitad). Mostrarla entre lo facturado decía "ya enviado a
      // Xubio" de algo que Xubio no tiene, y además juntaba en una sola línea ventas de días
      // distintos. Va con lo no facturado, marcada aparte.
      const marcada = expId.trim() === 'PENDIENTE';
      if (expId && expId !== '' && !marcada) {
        const key = `${expId}__${v.id_control}`;
        const ex = porExpCliente.get(key) || {
          id_exportacion: expId, fecha, fecha_exportacion: String(v.fecha_carga || fecha), cliente: nombre, id_control: String(v.id_control),
          sucursales: [],
          rucula: 0, lechuga: 0, rucula_kg: 0, lechuga_kg: 0, otros: {},
        };
        if (suc && !ex.sucursales.includes(suc)) ex.sucursales.push(suc);
        ex.rucula    += Number(v.rucula || 0);
        ex.lechuga   += Number(v.lechuga_crespa || 0) + Number(v.hoja_roble || 0);
        ex.rucula_kg  += Number(v.rucula_kg || 0);
        // lechuga_kg acá es el total en kg (rollup, igual que "lechuga" ya rollupea crespa+roble
        // en paquete) — suma la columna legacy + las dos nuevas por variedad.
        ex.lechuga_kg += Number(v.lechuga_kg || 0) + Number(v.lechuga_kg_crespa || 0) + Number(v.lechuga_kg_roble || 0);
        otrosDeVenta(v, keysOtros, ex.otros);
        porExpCliente.set(key, ex);

        const kcf = `${fecha}__${v.id_control}`;
        const lista = facturadoPorClienteFecha.get(kcf) || [];
        if (!lista.some((x) => x.id_exportacion === expId)) {
          lista.push({ id_exportacion: expId, fecha_exportacion: String(v.fecha_carga || fecha) });
        }
        facturadoPorClienteFecha.set(kcf, lista);
      } else {
        const key = `${fecha}__${v.id_control}__${marcada ? 'M' : ''}`;
        const p = pendientes.get(key) || {
          fecha, id_control: String(v.id_control), cliente: nombre, filas: 0, sucursales: [],
          rucula: 0, lechuga: 0, rucula_kg: 0, lechuga_kg: 0, otros: {},
          facturadoMismoDia: [], marcada,
        };
        p.filas++;
        if (suc && !p.sucursales.includes(suc)) p.sucursales.push(suc);
        p.rucula    += Number(v.rucula || 0);
        p.lechuga   += Number(v.lechuga_crespa || 0) + Number(v.hoja_roble || 0);
        p.rucula_kg  += Number(v.rucula_kg || 0);
        p.lechuga_kg += Number(v.lechuga_kg || 0) + Number(v.lechuga_kg_crespa || 0) + Number(v.lechuga_kg_roble || 0);
        otrosDeVenta(v, keysOtros, p.otros);
        pendientes.set(key, p);
      }
    }

    // Con algo cargado en CUALQUIER artículo, no solo en los cuatro de siempre.
    //
    // Antes el filtro era `rucula > 0 || lechuga > 0 || …kg > 0`, así que una venta de solo
    // microgreens o solo ensaladas desaparecía de las dos listas. En el historial se veía
    // como si nunca se hubiera facturado; en lo pendiente, peor: no aparecía como pendiente
    // y nadie se enteraba de que había quedado sin facturar.
    const tieneAlgo = (e: { rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number; otros: Record<string, number> }) =>
      e.rucula > 0 || e.lechuga > 0 || e.rucula_kg > 0 || e.lechuga_kg > 0
      || Object.values(e.otros).some((n) => Number(n) > 0);

    const exportaciones = [...porExpCliente.values()]
      .filter(tieneAlgo)
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id_exportacion.localeCompare(a.id_exportacion) || a.cliente.localeCompare(b.cliente))
      .slice(0, 600);

    const pendientesArr = [...pendientes.values()]
      .filter(tieneAlgo)
      .map((p) => ({ ...p, facturadoMismoDia: facturadoPorClienteFecha.get(`${p.fecha}__${p.id_control}`) || [] }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.cliente.localeCompare(b.cliente))
      // Por cliente son más filas que por fecha. 10 alcanzaba cuando era una por día y
      // ahora esconde pendientes reales.
      .slice(0, 80);

    const lastA = Number(config.find(c => c.clave === 'last_factura_a')?.valor || 665);
    const lastB = Number(config.find(c => c.clave === 'last_factura_b')?.valor || 575);
    return NextResponse.json({
      exportaciones, pendientes: pendientesArr, lastA, lastB,
      // Las columnas que la pantalla tiene que saber dibujar, con su etiqueta. Los artículos
      // de la hoja no están en el código del navegador, así que el nombre tiene que viajar.
      articulos: keysOtros.map((k) => ({ key: k, label: cat.labels[k] || k })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
