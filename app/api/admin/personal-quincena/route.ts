import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRowObj, asegurarHoja, readSheet, updateRow } from '@/lib/sheets';
import type { PersonalQuincena } from '@/lib/types';

const HEADERS = ['id', 'workno', 'anio', 'mes', 'quincena', 'presentismo_manual', 'extras', 'horas_extras'];

// Upsert: un registro por empleado+quincena (ajustes puntuales, no permanentes del
// empleado — presentismo manual, extras $, horas extra).
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const { workno, anio, mes, quincena } = body;
    if (!workno || !anio || !mes || !quincena) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    const id = `${workno}-${anio}-${mes}-${quincena}`;
    await asegurarHoja('PersonalQuincena', HEADERS);
    const existentes = await readSheet<PersonalQuincena>('PersonalQuincena');
    const fields = {
      presentismo_manual: body.presentismo_manual ?? '',
      extras: Number(body.extras) || 0,
      horas_extras: Number(body.horas_extras) || 0,
    };
    if (existentes.some((e) => String(e.id) === id)) {
      await updateRow('PersonalQuincena', 'id', id, fields);
    } else {
      await appendRowObj('PersonalQuincena', { id, workno: String(workno), anio, mes, quincena, ...fields });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
