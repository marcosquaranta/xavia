// app/api/admin/clientes/route.ts
// Crear nuevo cliente.

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRow, readSheet } from '@/lib/sheets';
import type { Cliente } from '@/lib/types';

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { nombre, tipo, contacto, telefono, direccion, notas, fecha_alta } = body;

    if (!nombre || !tipo) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }

    // Generar id incremental
    const clientes = await readSheet<Cliente>('Clientes');
    const max = clientes.reduce((acc, c) => {
      const n = Number(String(c.id_cliente).replace('CLI-', '')) || 0;
      return Math.max(acc, n);
    }, 0);
    const idCliente = `CLI-${String(max + 1).padStart(4, '0')}`;

    // Orden Clientes:
    // id_cliente, nombre, tipo, contacto, telefono, direccion, notas, activo, fecha_alta
    await appendRow('Clientes', [
      idCliente,
      nombre,
      tipo,
      contacto || '',
      telefono || '',
      direccion || '',
      notas || '',
      'SI',
      fecha_alta || new Date().toISOString().split('T')[0],
    ]);

    return NextResponse.json({ ok: true, id_cliente: idCliente });
  } catch (err: any) {
    console.error('Error creando cliente:', err);
    return NextResponse.json(
      { error: err.message || 'server_error' },
      { status: 500 }
    );
  }
}
