import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';
import { CATEGORIAS_GASTO, admiteMontoNegativo } from '@/lib/types';
import { fechaISO } from '@/lib/proveedores';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { id_gasto, fecha, descripcion, categoria, monto, medio_pago, cantidad, proveedor, vencimiento, empleado } = await req.json();
    if (!id_gasto) return NextResponse.json({ error: 'falta_id' }, { status: 400 });
    const montoNum = Number(monto);
    if (!isFinite(montoNum) || montoNum === 0 || (montoNum < 0 && !admiteMontoNegativo(categoria))) {
      return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
    }

    // Mismo chequeo que al crear: un adelanto sin empleado no se le descuenta a nadie, y
    // editarlo para sacarle el empleado lo dejaría registrado como gasto suelto.
    if (categoria === 'adelanto_sueldo' && empleado !== undefined && !String(empleado || '').trim()) {
      return NextResponse.json({ error: 'Un adelanto de sueldo tiene que decir de qué empleado es.' }, { status: 400 });
    }

    const ok = await updateRow('Gastos', 'id_gasto', id_gasto, {
      fecha, descripcion: String(descripcion || '').trim(),
      categoria: CATEGORIAS_GASTO.some((c) => c.value === categoria) ? categoria : 'gastos_generales',
      monto: montoNum, medio_pago,
      // La cantidad solo se toca si vino en el pedido: la edición desde Gastos no la manda,
      // y pisarla con 0 convertiría una compra de 40 bolsas en una compra sin cantidad —y
      // con eso se perdería el precio unitario, que se calcula dividiendo por ella.
      ...(cantidad !== undefined ? { cantidad: Number(cantidad) || 0 } : {}),
      // Proveedor y vencimiento: igual que `cantidad`, solo si vinieron. Son las columnas de
      // la cuenta corriente de proveedores, y la edición desde la pantalla de Gastos no las
      // manda — pisarlas con vacío convertiría una compra a 30 días en una compra sin
      // vencimiento, que deja de ordenarse y deja de contar como vencida.
      ...(proveedor !== undefined ? { proveedor: String(proveedor || '').trim() } : {}),
      // Se normaliza acá y no en la pantalla: la planilla ya tiene fechas escritas de cuatro
      // formas distintas y lo que se guarde de ahora en más tiene que ser una sola.
      ...(vencimiento !== undefined ? { vencimiento: fechaISO(vencimiento) } : {}),
      // A quién se le adelantó. Solo si viene, por lo mismo que los de arriba: la edición
      // desde Gastos no lo manda y borrarlo dejaría el adelanto sin dueño, o sea sin
      // descontarse de ningún sueldo.
      ...(empleado !== undefined ? { empleado: String(empleado || '').trim() } : {}),
    });
    if (!ok) return NextResponse.json({ error: 'gasto_no_encontrado' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
