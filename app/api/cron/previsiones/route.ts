import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { calcularEERR, previsionesSugeridas } from '@/lib/eerr';
import { leerPrevisiones, previsionDelMes, guardarPrevision } from '@/lib/previsiones';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { Articulo, StockMes, Gasto, VentaDia, PrecioVenta, ClienteVenta } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Las previsiones del mes, solas ────────────────────────────────────────────────────
//
// Despidos y SAC salen de una fórmula sobre la masa salarial: 6% y un doceavo. La app ya los
// calculaba y los proponía, pero había que entrar y apretar guardar — y mientras no se
// guardaban, no restaban del resultado. O sea: un paso manual obligatorio cuyo único aporte
// era confirmar una multiplicación.
//
// GUARDAR igual importa, y por eso esto escribe la fila en vez de calcularla al vuelo: lo que
// queda guardado es lo que fija el mes. Si el número se recalculara cada vez que alguien abre
// la pantalla, el resultado de septiembre cambiaría solo el día que se corrija un sueldo
// cargado tarde, y un cierre que se mueve no sirve para comparar contra nada.
//
// Dos decisiones que importan:
//
// · Corre DESPUÉS del día 5. Antes de eso los sueldos del mes todavía se están cargando, y
//   previsionar sobre una masa salarial a medias congelaría un número equivocado — que es
//   peor que no tener ninguno, porque parece cargado.
//
// · No pisa lo guardado. Si alguien ya guardó las previsiones del mes —a mano, con un ajuste
//   que ninguna fórmula sabe— eso gana. El automático completa lo que falta, no corrige a
//   nadie.
//
// Corre todos los días y es idempotente a propósito: una sola corrida mensual que falle por
// un timeout de Sheets dejaría el mes sin previsiones hasta el mes siguiente.

const DIA_MINIMO = 5;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // `forzar` existe para poder cerrar un mes el día 2 sin esperar al 5. Es manual: el cron
  // nunca lo manda.
  const forzar = new URL(req.url).searchParams.get('forzar') === 'si';

  const hoy = fechaArgentinaHoy();
  const [anioHoy, mesHoy, diaHoy] = hoy.split('-').map(Number);
  if (!forzar && diaHoy < DIA_MINIMO) {
    return NextResponse.json({
      ok: true, guardada: false,
      motivo: `Es el día ${diaHoy}: se espera al ${DIA_MINIMO} para que estén todos los sueldos del mes cerrado cargados.`,
    });
  }

  // El mes cerrado, que es el que se previsiona.
  let anio = anioHoy, mes = mesHoy - 1;
  if (mes === 0) { mes = 12; anio--; }

  try {
    const previas = await leerPrevisiones();
    const ya = previsionDelMes(previas, anio, mes);
    if (ya) {
      return NextResponse.json({
        ok: true, anio, mes, guardada: false,
        motivo: `${mes}/${anio} ya tiene previsiones guardadas (${ya.usuario || 'sin usuario'}). No se pisa lo que ya está.`,
      });
    }

    const [articulos, stocks, gastos, ventas, precios, clientes] = await Promise.all([
      readSheet<Articulo>('Articulos'),
      readSheet<StockMes>('Stocks'),
      readSheet<Gasto>('Gastos'),
      readSheet<VentaDia>('Ventas'),
      readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
      readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
    ]);

    const base = calcularEERR({ articulos, stocks, gastos, ventas, precios, clientes }, anio, mes);
    // Sin masa salarial no hay nada que previsionar, y guardar ceros sería peor que no
    // guardar: el checklist pasaría a ✓ sobre un mes al que todavía le faltan los sueldos.
    if (base.masaSalarial <= 0) {
      return NextResponse.json({
        ok: true, anio, mes, guardada: false,
        motivo: `${mes}/${anio} todavía no tiene sueldos cargados: sin masa salarial no hay previsión que calcular.`,
      });
    }

    const sug = previsionesSugeridas(base.masaSalarial);
    await guardarPrevision({
      anio, mes,
      despidos: sug.despidos,
      sac: sug.sac,
      // Alquiler y EPE no tienen fórmula: van a mano y no los toca el automático.
      alquiler: 0,
      epe: 0,
      notas: `Guardadas automáticamente el ${hoy} sobre una masa salarial de $${Math.round(base.masaSalarial).toLocaleString('es-AR')}.`,
      usuario: 'automático',
    });

    return NextResponse.json({
      ok: true, anio, mes, guardada: true,
      masaSalarial: Math.round(base.masaSalarial),
      despidos: sug.despidos, sac: sug.sac,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
