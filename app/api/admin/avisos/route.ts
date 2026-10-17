import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { appendRowObj, readSheet, updateRow } from '@/lib/sheets';
import { AVISOS } from '@/lib/avisosConfig';

export const dynamic = 'force-dynamic';

// Cambiar a quién le llega un aviso automático. Solo admin: define qué sale de la empresa y
// a qué dirección.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede cambiar esto.' }, { status: 403 });

  try {
    const { clave, valor } = await req.json();
    // Solo las claves de la lista. Sin esto, este endpoint sería una forma de escribir
    // cualquier fila de Configuracion desde afuera.
    const aviso = AVISOS.find((a) => a.clave === String(clave || '').trim());
    if (!aviso) return NextResponse.json({ error: 'Ese aviso no existe.' }, { status: 400 });

    const texto = String(valor || '').trim();
    const mails = texto.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    // Un mail mal escrito no hace fallar el envío: hace que llegue a menos gente, en
    // silencio. Es mejor frenarlo acá que descubrirlo el día que alguien pregunte por qué
    // nunca recibió nada.
    const malos = mails.filter((m) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m));
    if (malos.length) return NextResponse.json({ error: `No parece un mail: ${malos.join(', ')}` }, { status: 400 });

    const limpio = mails.join(', ');
    const filas = await readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => [] as { clave: string; valor: any }[]);
    const existe = filas.some((f) => String(f.clave).trim() === aviso.clave);
    if (existe) await updateRow('Configuracion', 'clave', aviso.clave, { valor: limpio });
    else await appendRowObj('Configuracion', { clave: aviso.clave, valor: limpio, descripcion: `Destinatarios del aviso: ${aviso.titulo}` });

    // Vacío = vuelve al default, no "a nadie". Se devuelve lo que va a quedar vigente para
    // que la pantalla pueda decirlo en vez de dejar un campo en blanco que parece apagado.
    return NextResponse.json({ ok: true, vigentes: mails.length ? mails : aviso.porDefecto, usandoDefault: !mails.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
