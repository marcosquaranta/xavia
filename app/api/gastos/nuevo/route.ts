import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { readSheet, appendRowObj, appendRowsObj, asegurarColumna, asegurarColumnas } from '@/lib/sheets';
import { CATEGORIAS_GASTO, admiteMontoNegativo, type Gasto } from '@/lib/types';
import { planDeCuotas, motivoSinCuotas, MAX_CUOTAS } from '@/lib/gastoCuotas';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  try {
    const { fecha, descripcion, categoria, monto, medio_pago, medio_pago_destino, id_articulo, cantidad, empleado, pendiente, proveedor, vencimiento, cuotas } = await req.json();
    if (!fecha || !descripcion || !medio_pago || monto === undefined) {
      return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });
    }
    // Un movimiento entre cuentas sin destino deja la plata saliendo de un lado y no
    // entrando a ninguno: los saldos no cerrarían nunca.
    if (categoria === 'movimiento_interno') {
      if (!medio_pago_destino) return NextResponse.json({ error: 'falta_destino' }, { status: 400 });
      if (medio_pago_destino === medio_pago) return NextResponse.json({ error: 'destino_igual_origen' }, { status: 400 });
    }
    const montoNum = Number(monto);
    const negativoOk = admiteMontoNegativo(categoria);
    if (!isFinite(montoNum) || montoNum === 0 || (montoNum < 0 && !negativoOk)) {
      return NextResponse.json({ error: 'monto_invalido' }, { status: 400 });
    }
    const cantidadNum = Number(cantidad) || 0;

    // Un adelanto sin empleado no se puede descontar del sueldo de nadie, que es para lo
    // único que sirve registrarlo aparte de los sueldos.
    // Ver el comentario de más abajo: un insumo sin artículo no entra al stock.
    if (categoria === 'insumos' && !String(id_articulo || '').trim()) {
      return NextResponse.json({ error: 'Un gasto de Insumos tiene que decir qué artículo se compró: sin eso entra al gasto pero no al stock, y el consumo del mes queda mal.' }, { status: 400 });
    }
    if (categoria === 'adelanto_sueldo' && !String(empleado || '').trim()) {
      return NextResponse.json({ error: 'falta_empleado' }, { status: 400 });
    }

    // Una compra pendiente sin proveedor no se le puede reclamar a nadie ni agrupar: la
    // deuda quedaría como un monto suelto que nadie sabe a quién corresponde.
    if (pendiente && !String(proveedor || '').trim()) {
      return NextResponse.json({ error: 'falta_proveedor' }, { status: 400 });
    }

    // ── Cuotas ──────────────────────────────────────────────────────────────────────────
    //
    // `monto` es siempre el precio de LA COMPRA; las cuotas se calculan acá, en el servidor,
    // y no se aceptan del cliente. Si el reparto se mandara ya hecho, dos pantallas podrían
    // repartir distinto y la suma de las cuotas dejaría de dar el total de la compra.
    const nCuotas = Math.floor(Number(cuotas) || 1);
    if (nCuotas > 1) {
      if (nCuotas > MAX_CUOTAS) return NextResponse.json({ error: `Son demasiadas cuotas (máximo ${MAX_CUOTAS}).` }, { status: 400 });
      const motivo = motivoSinCuotas(categoria);
      if (motivo) return NextResponse.json({ error: motivo }, { status: 400 });
      // Pendiente + cuotas serían dos formas de decir "todavía no pagué" encima de la misma
      // compra, y el total terminaría contado dos veces: una como deuda al proveedor y otra
      // repartida en las cuotas.
      if (pendiente) {
        return NextResponse.json({ error: 'Una compra en cuotas no se marca además como pendiente: cada cuota ya es su propio gasto en su mes. Si lo que querés es dejarla como deuda a un proveedor, cargala sin cuotas.' }, { status: 400 });
      }
    }

    await asegurarColumna('Gastos', 'medio_pago_destino');
    await asegurarColumna('Gastos', 'empleado');
    await asegurarColumnas('Gastos', ['estado_pago', 'proveedor', 'vencimiento']);
    if (nCuotas > 1) await asegurarColumnas('Gastos', ['cuota_grupo', 'cuota_nro', 'cuota_total', 'monto_compra_total']);
    const gastos = await readSheet<Gasto>('Gastos');
    const maxId = gastos
      .map((g) => parseInt(String(g.id_gasto).replace('GAS-', '') || '0'))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);
    const id_gasto = `GAS-${String(maxId + 1).padStart(4, '0')}`;
    const nuevoId = (i: number) => `GAS-${String(maxId + 1 + i).padStart(4, '0')}`;

    const categoriaFinal = CATEGORIAS_GASTO.some((c) => c.value === categoria) ? categoria : 'gastos_generales';
    const fechaCarga = new Date().toISOString().split('T')[0];
    const comun = {
      categoria: categoriaFinal,
      medio_pago,
      medio_pago_destino: categoria === 'movimiento_interno' ? medio_pago_destino : '',
      empleado: categoria === 'adelanto_sueldo' ? String(empleado).trim() : '',
      usuario: user.email,
      fecha_carga: fechaCarga,
    };

    const plan = nCuotas > 1
      ? planDeCuotas({ fecha, descripcion: String(descripcion).trim(), montoTotal: montoNum, cuotas: nCuotas })
      : [];

    if (plan.length > 1) {
      // El artículo y la cantidad van SOLO en la primera cuota: la mercadería llegó una vez.
      // Repetirlos en cada cuota sumaría la misma compra N veces al stock. Y con ellos va el
      // precio total de la compra, que es lo que vale para valorizar el artículo.
      const filas = plan.map((c, i) => ({
        id_gasto: nuevoId(i),
        fecha: c.fecha,
        descripcion: c.descripcion,
        monto: c.monto,
        ...comun,
        estado_pago: '',
        proveedor: String(proveedor || '').trim(),
        vencimiento: '',
        id_articulo: i === 0 ? (id_articulo || '') : '',
        cantidad: i === 0 && cantidadNum > 0 ? cantidadNum : '',
        // Las cuotas que no son la primera no tienen nada que aplicar al stock: se marcan
        // como ya resueltas para que no aparezcan como sugerencia de compra.
        aplicado_stock: i === 0 ? '' : 'SI',
        cuota_grupo: nuevoId(0),
        cuota_nro: c.nro,
        cuota_total: c.total,
        monto_compra_total: i === 0 ? montoNum : '',
      }));
      await appendRowsObj('Gastos', filas);
      return NextResponse.json({
        ok: true, id_gasto: filas[0].id_gasto, cuotas: plan.length,
        grupo: filas[0].cuota_grupo,
        desde: plan[0].fecha, hasta: plan[plan.length - 1].fecha,
      });
    }

    await appendRowObj('Gastos', {
      id_gasto, fecha,
      descripcion: String(descripcion).trim(),
      monto: montoNum,
      ...comun,
      estado_pago: pendiente ? 'pendiente' : '',
      proveedor: pendiente ? String(proveedor).trim() : '',
      vencimiento: pendiente ? String(vencimiento || '').trim() : '',
      id_articulo: id_articulo || '',
      cantidad: cantidadNum > 0 ? cantidadNum : '',
    });

    return NextResponse.json({ ok: true, id_gasto });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
