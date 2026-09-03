import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { guardarCobranza, borrarCobranza, guardarSaldoReal } from '@/lib/cuentas';
import { MEDIOS_PAGO } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const body = await req.json();
    const accion = String(body.accion || '');

    if (accion === 'cobranza_nueva') {
      const monto = Number(body.monto);
      if (!body.fecha || !body.medio_pago) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
      if (!MEDIOS_PAGO.includes(body.medio_pago)) return NextResponse.json({ error: 'medio_invalido' }, { status: 400 });
      if (!isFinite(monto) || monto <= 0) return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
      await guardarCobranza({
        fecha: String(body.fecha), medio_pago: String(body.medio_pago), monto,
        id_control: String(body.id_control || ''), notas: String(body.notas || ''), usuario: user.email,
      });
      return NextResponse.json({ ok: true });
    }

    if (accion === 'cobranza_borrar') {
      if (!body.id_cobranza) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
      const ok = await borrarCobranza(String(body.id_cobranza));
      return NextResponse.json({ ok, error: ok ? undefined : 'no_encontrada' }, { status: ok ? 200 : 404 });
    }

    if (accion === 'saldo_guardar') {
      const anio = Number(body.anio), mes = Number(body.mes), saldo = Number(body.saldo_real);
      if (!anio || !mes || mes < 1 || mes > 12) return NextResponse.json({ error: 'mes_invalido' }, { status: 400 });
      if (!MEDIOS_PAGO.includes(body.medio_pago)) return NextResponse.json({ error: 'medio_invalido' }, { status: 400 });
      // El saldo puede ser negativo (la tarjeta lo es casi siempre) pero no puede faltar.
      if (!isFinite(saldo)) return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
      await guardarSaldoReal({
        anio, mes, medio_pago: String(body.medio_pago), saldo_real: saldo,
        notas: String(body.notas || ''), usuario: user.email,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'accion_desconocida' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
