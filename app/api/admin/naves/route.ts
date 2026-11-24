// app/api/admin/naves/route.ts
// Actualiza la configuración de las mesadas: a qué cultivo están asignadas, en qué fase,
// y su geometría (módulos, perfiles, orificios).

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

// ── Por qué se valida tan duro ───────────────────────────────────────────────────────
//
// `calcularCapacidad` (lib/planificacionServer.ts) compara con ===: una mesada es de
// lechuga si `variedad_asignada === 'lechuga'`, y es F2 si `sector_fase === 'fase_2'`.
// Un valor con mayúscula, un espacio al final o una fase vacía no rompen nada: la mesada
// simplemente deja de contar para todos lados. La capacidad baja, el plan pide menos
// siembra, y no hay ningún error en ninguna pantalla que lo explique.
//
// Eso ya no puede entrar por acá. Lo que no es exactamente uno de estos valores se
// rechaza con el motivo, en vez de guardarse y desaparecer.
const VARIEDADES = ['lechuga', 'rucula', 'mixta', 'albahaca'] as const;
const FASES = ['plantin', 'fase_1', 'fase_2'] as const;

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  }

  try {
    const { ubicaciones } = await req.json();
    if (!Array.isArray(ubicaciones) || !ubicaciones.length) {
      return NextResponse.json({ error: 'datos_invalidos' }, { status: 400 });
    }

    // Se valida TODO antes de escribir nada. Guardar media tanda y fallar en la quinta
    // mesada deja la nave en un estado que nadie pidió, y encima hay que adivinar cuáles
    // entraron.
    const problemas: string[] = [];
    for (const u of ubicaciones) {
      const n = String(u.nombre || u.id_ubicacion || '¿?');
      if (!u.id_ubicacion) { problemas.push(`${n}: sin id_ubicacion`); continue; }
      if (!VARIEDADES.includes(u.variedad_asignada)) {
        problemas.push(`${n}: cultivo "${u.variedad_asignada}" no es uno de ${VARIEDADES.join(', ')}`);
      }
      if (!FASES.includes(u.sector_fase)) {
        problemas.push(`${n}: fase "${u.sector_fase}" no es una de ${FASES.join(', ')}`);
      }
      // Una mesada de lechuga sin F1 ni F2 no la cuenta nadie: ver la nota de arriba.
      if (u.tipo === 'mesada' && u.variedad_asignada === 'lechuga' && u.sector_fase !== 'fase_1' && u.sector_fase !== 'fase_2') {
        problemas.push(`${n}: una mesada de lechuga tiene que estar en Fase 1 o Fase 2, si no no cuenta para el plan`);
      }
      for (const campo of ['modulos', 'perfiles_por_modulo', 'orificios_por_perfil'] as const) {
        const v = Number(u[campo]);
        if (!Number.isFinite(v) || v < 0) problemas.push(`${n}: ${campo} tiene que ser un número ≥ 0`);
      }
    }
    if (problemas.length) {
      return NextResponse.json({ error: problemas.join(' · ') }, { status: 400 });
    }

    const guardadas: string[] = [];
    for (const u of ubicaciones) {
      const capacidad = Math.round(
        (Number(u.modulos) || 0) * (Number(u.perfiles_por_modulo) || 0) * (Number(u.orificios_por_perfil) || 0),
      );
      await updateRow('Ubicaciones', 'id_ubicacion', u.id_ubicacion, {
        variedad_asignada: u.variedad_asignada,
        sector_fase: u.sector_fase,
        modulos: Number(u.modulos) || 0,
        perfiles_por_modulo: Number(u.perfiles_por_modulo) || 0,
        orificios_por_perfil: Number(u.orificios_por_perfil) || 0,
        capacidad_calculada: capacidad,
      });
      guardadas.push(String(u.id_ubicacion));
    }

    return NextResponse.json({ ok: true, guardadas });
  } catch (err: any) {
    console.error('Error guardando naves:', err);
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
