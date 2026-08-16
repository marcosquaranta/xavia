import { NextRequest, NextResponse } from 'next/server';
import { getRegistrosCrossChex } from '@/lib/crosschex';
import { horasHombreEnRango, hoyArg } from '@/lib/personal';
import { asegurarHoja, updateRow, appendRowObj } from '@/lib/sheets';

export const dynamic = 'force-dynamic';
// Token + datos (y alguna página de más si el día tuvo muchos fichajes) con el límite
// real de CrossChex (1 pedido/15s, ver lib/crosschex.ts) puede tardar bastante.
export const maxDuration = 60;

// Carga la caché diaria de horas-hombre (hoja ProductividadDiaria) que alimenta el
// indicador de Productividad en Panel/Estadísticas — CrossChex limita a 1 pedido cada 15
// segundos, así que esas páginas ya NO le piden datos en vivo, solo leen esta hoja.
// Lo dispara Vercel Cron (vercel.json) una vez por día, temprano a la mañana, y trae el
// día ANTERIOR completo (ya cerrado — sin fichajes pendientes de esa jornada).
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const hoyStr = hoyArg();
    const ayerDate = new Date(hoyStr + 'T12:00:00');
    ayerDate.setDate(ayerDate.getDate() - 1);
    const ayerStr = `${ayerDate.getFullYear()}-${String(ayerDate.getMonth() + 1).padStart(2, '0')}-${String(ayerDate.getDate()).padStart(2, '0')}`;

    const registros = await getRegistrosCrossChex(`${ayerStr}T00:00:00-03:00`, `${ayerStr}T23:59:59-03:00`);
    const horas = horasHombreEnRango(registros);

    await asegurarHoja('ProductividadDiaria', ['fecha', 'horas_hombre', 'actualizado']);
    const actualizado = new Date().toISOString();
    const yaExistia = await updateRow('ProductividadDiaria', 'fecha', ayerStr, { horas_hombre: horas, actualizado });
    if (!yaExistia) {
      await appendRowObj('ProductividadDiaria', { fecha: ayerStr, horas_hombre: horas, actualizado });
    }

    return NextResponse.json({ ok: true, fecha: ayerStr, horas, fichajes: registros.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || 'error' }, { status: 500 });
  }
}
