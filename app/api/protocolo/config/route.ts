import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, readSheet, updateRow } from '@/lib/sheets';
import {
  CONFIG_ACTIVO, CONFIG_AFITAL_ANCLA, CONFIG_SERENADE_DIAS, CONFIG_SERENADE_ANCLA, CONFIG_ALARMA_EMAILS,
} from '@/lib/protocoloTareas';

// Los dos parámetros que la especificación pide dejar editables (el ancla del ciclo de 14
// días de Afital y la frecuencia de Serenade, 30 días en primavera y 15 en verano) más el
// interruptor para apagar el protocolo fuera de temporada. Van a la hoja Configuracion,
// que es donde ya viven el resto de los parámetros de la app.
const DESCRIPCIONES: Record<string, string> = {
  [CONFIG_ACTIVO]: 'Protocolo de aplicaciones activo (SI/NO)',
  [CONFIG_AFITAL_ANCLA]: 'Primer miércoles de aplicación de Afital (YYYY-MM-DD) — ancla del ciclo de 14 días',
  [CONFIG_SERENADE_DIAS]: 'Cada cuántos días se aplica Serenade en el tanque de riego (30 primavera / 15 verano)',
  [CONFIG_SERENADE_ANCLA]: 'Primera aplicación de Serenade (YYYY-MM-DD) — desde ahí se cuentan los días',
  [CONFIG_ALARMA_EMAILS]: 'Mails que reciben la alarma del agua de ósmosis, separados por coma',
};

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede cambiar el protocolo.' }, { status: 403 });
  try {
    const body = await req.json();
    const cambios: Record<string, string> = {};

    if (body[CONFIG_ACTIVO] !== undefined) {
      cambios[CONFIG_ACTIVO] = String(body[CONFIG_ACTIVO]).toUpperCase() === 'NO' ? 'NO' : 'SI';
    }
    for (const clave of [CONFIG_AFITAL_ANCLA, CONFIG_SERENADE_ANCLA]) {
      if (body[clave] === undefined) continue;
      const v = String(body[clave] || '').trim();
      if (v && !esFecha(v)) return NextResponse.json({ error: `${clave}: la fecha tiene que ser YYYY-MM-DD.` }, { status: 400 });
      cambios[clave] = v;
    }
    if (body[CONFIG_SERENADE_DIAS] !== undefined) {
      const n = Number(body[CONFIG_SERENADE_DIAS]);
      if (!(n > 0)) return NextResponse.json({ error: 'La frecuencia de Serenade tiene que ser un número de días mayor a 0.' }, { status: 400 });
      cambios[CONFIG_SERENADE_DIAS] = String(Math.round(n));
    }
    if (body[CONFIG_ALARMA_EMAILS] !== undefined) {
      const lista = String(body[CONFIG_ALARMA_EMAILS] || '').split(',').map((x: string) => x.trim()).filter(Boolean);
      const invalido = lista.find((x: string) => !x.includes('@'));
      if (invalido) return NextResponse.json({ error: `"${invalido}" no parece un mail.` }, { status: 400 });
      cambios[CONFIG_ALARMA_EMAILS] = lista.join(', ');
    }
    if (!Object.keys(cambios).length) return NextResponse.json({ error: 'No hay nada para cambiar.' }, { status: 400 });

    // La hoja Configuracion ya existe (la usa toda la app), pero estas claves pueden no
    // estar todavía: si no están, se agregan; si están, se actualiza el valor.
    const filas = await readSheet<{ clave: string; valor: any; descripcion?: string }>('Configuracion');
    for (const [clave, valor] of Object.entries(cambios)) {
      const existe = filas.some((f) => String(f.clave).trim() === clave);
      if (existe) await updateRow('Configuracion', 'clave', clave, { valor });
      else await appendRowObj('Configuracion', { clave, valor, descripcion: DESCRIPCIONES[clave] || '' });
    }
    return NextResponse.json({ ok: true, cambios });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
