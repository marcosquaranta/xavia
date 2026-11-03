import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { gastoDesdeTexto, type EmpleadoParaGasto } from '@/lib/gastoDesdeTexto';
import { readSheet } from '@/lib/sheets';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';

// Interpreta una frase y devuelve un BORRADOR de gasto. No escribe nada: el borrador se
// muestra en el formulario de siempre y se guarda por el camino de siempre, cuando alguien
// lo acepta. Esta ruta es solo lectura, a propósito — si alguna vez guardara sola, habría
// dos formas de crear un gasto y una de ellas sin nadie mirándola.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { texto } = await req.json();
    const t = String(texto || '').trim();
    if (t.length < 4) return NextResponse.json({ error: 'Escribí el gasto, aunque sea corto: "nafta 50.000 Marcos".' }, { status: 400 });

    // Los empleados son para el caso del adelanto de sueldo: sin la lista, el modelo no
    // puede devolver un workno y el adelanto quedaría sin atar a nadie, que es lo único
    // que hace que después se descuente del sueldo.
    const empleados: EmpleadoParaGasto[] = await readSheet<any>('Empleados')
      .then(rows => rows.map(e => ({ workno: String(e.workno || ''), nombre: String(e.nombre || '') })).filter(e => e.workno))
      .catch(() => []);

    const propuesta = await gastoDesdeTexto(t, fechaArgentinaHoy(), empleados);
    if (!propuesta) {
      return NextResponse.json({ error: 'No pude interpretarlo. Probá escribiéndolo más directo: "nafta 50.000 pagó Marcos".' }, { status: 422 });
    }
    return NextResponse.json({ ok: true, propuesta });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
