import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { guardarAjuste } from '@/lib/ajusteFactura';

export const dynamic = 'force-dynamic';

// Corregir a mano cuánto vale una factura, desde la misma lista donde se la está imputando.
//
// Es el caso que trababa todo: el aviso dice que paga $X, la factura figura por $Y, y la
// diferencia es un error de carga —una cantidad mal puesta, un precio viejo—. Hasta ahora
// había que salir de la bandeja, ir a editar el comprobante y volver, y en el medio se
// perdía todo lo que ya se había tildado.
//
// NO toca Xubio. Es un ajuste que vive en la app, igual que el de la pantalla de
// comprobantes: Xubio sigue teniendo el importe que emitió, y acá se registra lo que la
// factura vale de verdad, con el motivo y quién lo hizo.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede ajustar una factura.' }, { status: 403 });

  try {
    const { numero, id_control, cliente, importeXubio, importeApp, motivo } = await req.json();
    const num = String(numero || '').trim();
    if (!num) return NextResponse.json({ error: 'Falta el número de factura.' }, { status: 400 });

    const nuevo = Math.round(Number(importeApp));
    if (!isFinite(nuevo) || nuevo < 0) return NextResponse.json({ error: 'El importe tiene que ser un número mayor o igual a 0.' }, { status: 400 });

    // El motivo es obligatorio. Un ajuste sin motivo es un número que alguien cambió y que
    // en tres meses nadie va a poder explicar — y lo que se está cambiando es cuánto debe
    // un cliente.
    const porQue = String(motivo || '').trim();
    if (!porQue) return NextResponse.json({ error: 'Poné por qué se ajusta: en tres meses esto va a ser un número que nadie puede explicar.' }, { status: 400 });

    await guardarAjuste({
      numero: num,
      id_control: String(id_control || ''),
      cliente: String(cliente || ''),
      importeXubio: Math.round(Number(importeXubio) || 0),
      importeApp: nuevo,
      motivo: porQue,
      usuario: user.email,
    });

    return NextResponse.json({ ok: true, numero: num, importeApp: nuevo });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
