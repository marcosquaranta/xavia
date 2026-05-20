// app/api/admin/migrar-ids/route.ts
// Migra IDs del formato viejo (N2R1-015) al nuevo (N2R-015)
// Solo admin. Ejecutar UNA sola vez.

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { Lote, Movimiento } from '@/lib/types';

function nuevoFormato(id: string): string | null {
  // Ya está en nuevo formato
  if (/^N[12][LRA]-\d+[A-Z]?$/.test(id)) return null;
  if (/^N[12]-\d+$/.test(id)) return null; // provisional, no tocar

  // Viejo formato con mesada: N2R1-015 → N2R-015
  const viejo = /^N([12])([LRA])[12]-(\d+)([A-Z]?)$/.exec(id);
  if (viejo) return `N${viejo[1]}${viejo[2]}-${viejo[3]}${viejo[4]}`;

  return null;
}

export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  const dryRun = new URL(req.url).searchParams.get('dry') === '1';

  try {
    const [lotes, movimientos] = await Promise.all([
      readSheet<Lote>('Lotes'),
      readSheet<Movimiento>('Movimientos'),
    ]);

    const cambios: { viejo: string; nuevo: string }[] = [];
    const errores: string[] = [];

    // Detectar todos los cambios necesarios
    for (const lote of lotes) {
      const nuevo = nuevoFormato(lote.id_lote);
      if (nuevo) {
        // Verificar que el nuevo ID no exista ya (excepto si es el mismo lote)
        const yaExiste = lotes.some((l) => l.id_lote === nuevo && l.id_lote !== lote.id_lote);
        if (yaExiste) {
          errores.push(`Colisión: ${lote.id_lote} → ${nuevo} (ya existe)`);
        } else {
          cambios.push({ viejo: lote.id_lote, nuevo });
        }
      }
    }

    if (errores.length > 0) {
      return NextResponse.json({ ok: false, errores, mensaje: 'Hay colisiones — revisar antes de migrar' }, { status: 400 });
    }

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, cambios, total: cambios.length });
    }

    // Ejecutar migración
    let migrados = 0;
    for (const { viejo, nuevo } of cambios) {
      // 1. Actualizar en Lotes
      await updateRow('Lotes', 'id_lote', viejo, { id_lote: nuevo });

      // 2. Actualizar en Movimientos
      const movsLote = movimientos.filter((m) => m.id_lote === viejo);
      for (const m of movsLote) {
        await updateRow('Movimientos', 'id_movimiento', String(m.id_movimiento), { id_lote: nuevo });
      }
      migrados++;
    }

    return NextResponse.json({ ok: true, migrados, cambios });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
