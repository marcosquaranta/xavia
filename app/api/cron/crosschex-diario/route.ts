import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { getRegistrosCrossChex } from '@/lib/crosschex';
import { horasHombreEnRango, hoyArg, fechaArg } from '@/lib/personal';
import { guardarFichajes } from '@/lib/fichajesCache';
import { asegurarHoja, updateRow, appendRowObj } from '@/lib/sheets';

export const dynamic = 'force-dynamic';
// Token + varias páginas, con el límite real de CrossChex (1 pedido/15s), puede tardar.
export const maxDuration = 300;

// ÚNICO punto de la app que le habla a CrossChex. Guarda los fichajes crudos en la hoja
// FichajesDiarios (ver lib/fichajesCache.ts) y, de paso, recalcula la caché de horas-hombre
// de ProductividadDiaria — antes eso era un segundo cron con su propia consulta.
//
// Todo lo demás (banner de tardanzas del home, Admin → Personal) lee esas hojas, que son
// una lectura de Sheets normal. Antes consultaban CrossChex en vivo y, con el límite de 1
// pedido cada 15 segundos, una quincena eran ~60-75 segundos de espera por pantalla.
//
// Ventana: los últimos DIAS_VENTANA días hasta hoy inclusive. Se re-piden días ya
// guardados a propósito: si una corrida falla o un día quedó a medias (fichajes cargados
// tarde, alguien que fichó la salida después), la corrida siguiente lo completa sola. Hoy
// entra en la ventana para que el banner de tardanzas tenga los ingresos de la mañana.
const DIAS_VENTANA = 4;

export async function GET(req: NextRequest) {
  // Lo dispara Vercel Cron, pero también puede correrlo un admin a mano desde
  // Admin → Personal cuando necesita sincronizar un rango viejo (?desde=&hasta=).
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const hoyStr = hoyArg();
    const desdeParam = url.searchParams.get('desde');
    const hastaParam = url.searchParams.get('hasta');

    let desdeStr = desdeParam || '';
    if (!desdeStr) {
      const d = new Date(hoyStr + 'T12:00:00');
      d.setDate(d.getDate() - (DIAS_VENTANA - 1));
      desdeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const hastaStr = hastaParam || hoyStr;

    const registros = await getRegistrosCrossChex(`${desdeStr}T00:00:00-03:00`, `${hastaStr}T23:59:59-03:00`);
    const guardado = await guardarFichajes(registros);

    // Horas-hombre por día, solo de los días COMPLETOS (hoy todavía no cerró: faltan las
    // salidas, así que guardarlo daría un número bajo que después nadie corrige).
    await asegurarHoja('ProductividadDiaria', ['fecha', 'horas_hombre', 'actualizado']);
    const porDia = new Map<string, typeof registros>();
    for (const r of registros) {
      const f = fechaArg(String(r.checktime || ''));
      if (!f || f >= hoyStr) continue;
      if (!porDia.has(f)) porDia.set(f, []);
      porDia.get(f)!.push(r);
    }
    const actualizado = new Date().toISOString();
    let diasProductividad = 0;
    for (const [fecha, delDia] of porDia) {
      const horas = horasHombreEnRango(delDia);
      const yaExistia = await updateRow('ProductividadDiaria', 'fecha', fecha, { horas_hombre: horas, actualizado });
      if (!yaExistia) await appendRowObj('ProductividadDiaria', { fecha, horas_hombre: horas, actualizado });
      diasProductividad++;
    }

    return NextResponse.json({
      ok: true, desde: desdeStr, hasta: hastaStr,
      fichajes: registros.length, filas: guardado.filas, dias: guardado.dias, diasProductividad,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || 'error' }, { status: 500 });
  }
}
