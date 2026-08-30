import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia, ClienteVenta, ConfigItem } from '@/lib/types';
import { mapaNombresClientes } from '@/lib/clientes';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const [ventas, clientes, config] = await Promise.all([
      readSheet<VentaDia>('Ventas'),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<ConfigItem>('Config'),
    ]);

    const clienteMap = mapaNombresClientes(clientes);

    // Una línea por (exportación, cliente) — en Xubio se factura una sola vez por cliente
    // por tanda, aunque combine varias sucursales, así que agrupar por cliente (no por
    // sucursal) refleja exactamente la factura real.
    type EntradaExpCliente = {
      id_exportacion: string; fecha: string; fecha_exportacion: string; cliente: string; id_control: string;
      rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
    };
    const porExpCliente = new Map<string, EntradaExpCliente>();

    type EntradaPend = {
      fecha: string; filas: number; rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
    };
    const pendientes = new Map<string, EntradaPend>();

    for (const v of ventas) {
      if (!v.fecha) continue;
      const fecha = String(v.fecha).split(/[\sT]/)[0];
      const expId = String(v.exportado || '');

      if (expId && expId !== '') {
        const nombre = clienteMap.get(String(v.id_control)) || String(v.id_control);
        const key = `${expId}__${v.id_control}`;
        const ex = porExpCliente.get(key) || {
          id_exportacion: expId, fecha, fecha_exportacion: String(v.fecha_carga || fecha), cliente: nombre, id_control: String(v.id_control),
          rucula: 0, lechuga: 0, rucula_kg: 0, lechuga_kg: 0,
        };
        ex.rucula    += Number(v.rucula || 0);
        ex.lechuga   += Number(v.lechuga_crespa || 0) + Number(v.hoja_roble || 0);
        ex.rucula_kg  += Number(v.rucula_kg || 0);
        // lechuga_kg acá es el total en kg (rollup, igual que "lechuga" ya rollupea crespa+roble
        // en paquete) — suma la columna legacy + las dos nuevas por variedad.
        ex.lechuga_kg += Number(v.lechuga_kg || 0) + Number(v.lechuga_kg_crespa || 0) + Number(v.lechuga_kg_roble || 0);
        porExpCliente.set(key, ex);
      } else {
        const p = pendientes.get(fecha) || {
          fecha, filas: 0, rucula: 0, lechuga: 0, rucula_kg: 0, lechuga_kg: 0,
        };
        p.filas++;
        p.rucula    += Number(v.rucula || 0);
        p.lechuga   += Number(v.lechuga_crespa || 0) + Number(v.hoja_roble || 0);
        p.rucula_kg  += Number(v.rucula_kg || 0);
        p.lechuga_kg += Number(v.lechuga_kg || 0) + Number(v.lechuga_kg_crespa || 0) + Number(v.lechuga_kg_roble || 0);
        pendientes.set(fecha, p);
      }
    }

    const exportaciones = [...porExpCliente.values()]
      .filter(e => e.rucula > 0 || e.lechuga > 0 || e.rucula_kg > 0 || e.lechuga_kg > 0)
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id_exportacion.localeCompare(a.id_exportacion) || a.cliente.localeCompare(b.cliente))
      .slice(0, 150);

    const pendientesArr = [...pendientes.values()]
      .filter(p => p.rucula > 0 || p.lechuga > 0 || p.rucula_kg > 0 || p.lechuga_kg > 0)
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, 10);

    const lastA = Number(config.find(c => c.clave === 'last_factura_a')?.valor || 665);
    const lastB = Number(config.find(c => c.clave === 'last_factura_b')?.valor || 575);
    return NextResponse.json({ exportaciones, pendientes: pendientesArr, lastA, lastB });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
