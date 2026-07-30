import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRowObj, asegurarHoja, deleteRow, readSheet, updateRow } from '@/lib/sheets';
import type { Empleado } from '@/lib/types';

const HEADERS = ['workno', 'nombre', 'sueldo_hora', 'horas_teoricas_quincena', 'horas_lv', 'horas_sabado', 'presentismo', 'hora_entrada_esperada', 'hora_salida_esperada', 'activo'];

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const body = await req.json();
    const { workno, nombre } = body;
    if (!workno || !nombre) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    await asegurarHoja('Empleados', HEADERS);
    const empleados = await readSheet<Empleado>('Empleados');
    if (empleados.some((e) => String(e.workno) === String(workno))) {
      return NextResponse.json({ error: 'Ya existe un empleado con ese legajo (workno)' }, { status: 400 });
    }
    await appendRowObj('Empleados', {
      workno: String(workno), nombre,
      sueldo_hora: Number(body.sueldo_hora) || 0,
      horas_teoricas_quincena: Number(body.horas_teoricas_quincena) || 46,
      horas_lv: Number(body.horas_lv) || 0,
      horas_sabado: Number(body.horas_sabado) || 0,
      presentismo: Number(body.presentismo) || 50000,
      hora_entrada_esperada: body.hora_entrada_esperada || '08:00',
      hora_salida_esperada: body.hora_salida_esperada || '17:00',
      activo: 'SI',
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { workno, ...fields } = await req.json();
    if (!workno) return NextResponse.json({ error: 'falta_workno' }, { status: 400 });
    const ok = await updateRow('Empleados', 'workno', String(workno), fields);
    if (!ok) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { workno } = await req.json();
    if (!workno) return NextResponse.json({ error: 'falta_workno' }, { status: 400 });
    const ok = await deleteRow('Empleados', 'workno', String(workno));
    if (!ok) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
