import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRowObj, readRaw, readSheet, setRowByHeader } from '@/lib/sheets';
import type { PrecioVenta } from '@/lib/types';

// Upsert de precio por id_control + sucursal_obs
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const {
      id_control, nombre_cliente, sucursal_obs, rucula, lechuga_crespa, hoja_roble,
      bandeja_rucula, albahaca, rucula_kg, lechuga_kg, lechuga_kg_crespa, lechuga_kg_roble,
    } = await req.json();
    if (!id_control || !sucursal_obs) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });

    const precios = await readSheet<PrecioVenta>('Precios');
    const existe = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal_obs);
    // Cada campo: si viene en el request se usa, si no se preserva el valor existente
    const campo = (val: any, key: keyof PrecioVenta) => val !== undefined ? Number(val) || 0 : Number((existe as any)?.[key]) || 0;

    // Por nombre de columna (no por posición): Precios no tiene id único así que no se puede
    // usar updateRow (una sola clave), pero setRowByHeader/appendRowObj evitan tener que llevar
    // la cuenta de en qué letra de columna cae cada campo — importante con columnas nuevas
    // como lechuga_kg_crespa/lechuga_kg_roble.
    const camposObj: Record<string, any> = {
      id_control: String(id_control), nombre_cliente: nombre_cliente || (existe as any)?.nombre_cliente || '', sucursal_obs,
      rucula: campo(rucula, 'rucula'), lechuga_crespa: campo(lechuga_crespa, 'lechuga_crespa'), hoja_roble: campo(hoja_roble, 'hoja_roble'),
      bandeja_rucula: campo(bandeja_rucula, 'bandeja_rucula'), albahaca: campo(albahaca, 'albahaca'),
      rucula_kg: campo(rucula_kg, 'rucula_kg'), lechuga_kg: campo(lechuga_kg, 'lechuga_kg'),
      lechuga_kg_crespa: campo(lechuga_kg_crespa, 'lechuga_kg_crespa'), lechuga_kg_roble: campo(lechuga_kg_roble, 'lechuga_kg_roble'),
    };

    if (existe) {
      const raw = await readRaw('Precios');
      const headers = raw[0] || [];
      const idxId = headers.indexOf('id_control'), idxSuc = headers.indexOf('sucursal_obs');
      const rowIdx = raw.findIndex((r, i) => i > 0 && String(r[idxId]) === String(id_control) && r[idxSuc] === sucursal_obs);
      if (rowIdx > 0) await setRowByHeader('Precios', rowIdx + 1, headers, camposObj);
    } else {
      await appendRowObj('Precios', camposObj);
    }

    return NextResponse.json({ ok: true, accion: existe ? 'actualizado' : 'creado' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
