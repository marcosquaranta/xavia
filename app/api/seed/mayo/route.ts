import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, appendRow } from '@/lib/sheets';
import type { ClienteVenta, VentaDia } from '@/lib/types';

// Endpoint temporal — llamar UNA sola vez para cargar ventas de mayo
// Borrar después de usar

const MAYO_DATA = [
  { nombre: 'Poly Verdulerias',           rucula: 560,  lechuga_crespa: 350,  hoja_roble: 80 },
  { nombre: 'FORNO VIENA',                rucula: 98,   lechuga_crespa: 225,  hoja_roble: 0  },
  { nombre: 'ANDRES CLAUDIO ISABELLA',    rucula: 60,   lechuga_crespa: 100,  hoja_roble: 0  },
  { nombre: 'PRODUCTOS LA AMALIA SRL',    rucula: 250,  lechuga_crespa: 2100, hoja_roble: 0  },
  { nombre: 'DAVID ROSENTAL E HIJOS SAC', rucula: 690,  lechuga_crespa: 840,  hoja_roble: 130 },
  { nombre: 'LA GALLEGA SUPERMERCADOS SA',rucula: 1160, lechuga_crespa: 700,  hoja_roble: 200 },
  { nombre: 'LA REINA S A',               rucula: 920,  lechuga_crespa: 1410, hoja_roble: 0  },
  { nombre: 'FLAN PARISINO',              rucula: 4,    lechuga_crespa: 40,   hoja_roble: 0  },
  { nombre: 'MARIEL EUGENIA SANCHEZ',     rucula: 50,   lechuga_crespa: 80,   hoja_roble: 0  },
];

const FECHA = '2026-05-01';

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  const [clientes, ventas] = await Promise.all([
    readSheet<ClienteVenta>('Clientes'),
    readSheet<VentaDia>('Ventas'),
  ]);

  // Verificar que no existan ya filas para esta fecha
  const yaExisten = ventas.filter(v => v.fecha === FECHA);
  if (yaExisten.length > 0) {
    return NextResponse.json({
      error: `Ya existen ${yaExisten.length} filas para ${FECHA}. Borralas primero si querés reimportar.`,
      filas: yaExisten.map(v => ({ id: v.id_venta, sucursal: v.sucursal })),
    }, { status: 400 });
  }

  let nextId = ventas
    .map(v => parseInt(v.id_venta?.replace('V-', '') || '0'))
    .filter(n => !isNaN(n))
    .reduce((m, n) => Math.max(m, n), 0) + 1;

  const fechaCarga = new Date().toISOString().split('T')[0];
  const insertados: string[] = [];
  const errores: string[] = [];

  for (const entry of MAYO_DATA) {
    // Buscar cliente por nombre parcial (case-insensitive)
    const cliente = clientes.find(c =>
      c.activo === 'SI' &&
      (c.nombre_xubio?.toLowerCase().includes(entry.nombre.toLowerCase()) ||
       entry.nombre.toLowerCase().includes(c.nombre_xubio?.toLowerCase() || ''))
    );

    if (!cliente) {
      errores.push(`No encontrado: "${entry.nombre}"`);
      continue;
    }

    const id = `V-${String(nextId++).padStart(5, '0')}`;
    // Usar nombre_xubio como sucursal para el resumen mensual
    await appendRow('Ventas', [
      id, FECHA,
      cliente.id_control, cliente.nombre_xubio, cliente.nombre_xubio,
      entry.rucula, entry.lechuga_crespa, entry.hoja_roble,
      0, 0,   // bandeja_rucula, albahaca
      0, 0,   // rucula_kg, lechuga_kg
      '', user.email, fechaCarga,
    ]);
    insertados.push(`${id} · ${cliente.nombre_xubio} · rucula=${entry.rucula} crespa=${entry.lechuga_crespa} roble=${entry.hoja_roble}`);
  }

  return NextResponse.json({ ok: true, insertados, errores });
}
