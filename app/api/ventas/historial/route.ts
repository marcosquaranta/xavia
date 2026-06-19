import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia, ClienteVenta, ConfigItem } from '@/lib/types';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const [ventas, clientes, config] = await Promise.all([
      readSheet<VentaDia>('Ventas'),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<ConfigItem>('Config'),
    ]);

    const clienteMap = new Map(clientes.map(c => [String(c.id_control), c.nombre_display || c.nombre_xubio || c.id_control]));

    type EntradaExp = {
      id_exportacion: string; fecha: string; fecha_exportacion: string;
      facturas: number; clientesNombres: string[];
      rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
    };
    const porExp = new Map<string, EntradaExp>();

    type EntradaPend = {
      fecha: string; filas: number; rucula: number; lechuga: number; rucula_kg: number; lechuga_kg: number;
    };
    const pendientes = new Map<string, EntradaPend>();

    for (const v of ventas) {
      if (!v.fecha) continue;
      const fecha = String(v.fecha).split(/[\sT]/)[0];
      const expId = String(v.exportado || '');

      if (expId && expId !== '') {
        const ex = porExp.get(expId) || {
          id_exportacion: expId, fecha, fecha_exportacion: String(v.fecha_carga || fecha),
          facturas: 0, clientesNombres: [],
          rucula: 0, lechuga: 0, rucula_kg: 0, lechuga_kg: 0,
        };
        // Contar clientes distintos con al menos una cantidad > 0
        const tieneVentas = ['rucula','lechuga_crespa','hoja_roble','bandeja_rucula','albahaca','rucula_kg','lechuga_kg']
          .some(k => Number((v as any)[k]) > 0);
        const nombre = clienteMap.get(String(v.id_control)) || String(v.id_control);
        if (tieneVentas && !ex.clientesNombres.includes(nombre)) {
          ex.facturas++;
          ex.clientesNombres.push(nombre);
        }
        ex.rucula    += Number(v.rucula || 0);
        ex.lechuga   += Number(v.lechuga_crespa || 0) + Number(v.hoja_roble || 0);
        ex.rucula_kg  += Number(v.rucula_kg || 0);
        ex.lechuga_kg += Number(v.lechuga_kg || 0);
        porExp.set(expId, ex);
      } else {
        const p = pendientes.get(fecha) || {
          fecha, filas: 0, rucula: 0, lechuga: 0, rucula_kg: 0, lechuga_kg: 0,
        };
        p.filas++;
        p.rucula    += Number(v.rucula || 0);
        p.lechuga   += Number(v.lechuga_crespa || 0) + Number(v.hoja_roble || 0);
        p.rucula_kg  += Number(v.rucula_kg || 0);
        p.lechuga_kg += Number(v.lechuga_kg || 0);
        pendientes.set(fecha, p);
      }
    }

    const exportaciones = [...porExp.values()]
      .sort((a, b) => b.id_exportacion.localeCompare(a.id_exportacion))
      .slice(0, 40);

    const pendientesArr = [...pendientes.values()]
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, 10);

    const lastA = Number(config.find(c => c.clave === 'last_factura_a')?.valor || 665);
    const lastB = Number(config.find(c => c.clave === 'last_factura_b')?.valor || 575);
    return NextResponse.json({ exportaciones, pendientes: pendientesArr, lastA, lastB });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
