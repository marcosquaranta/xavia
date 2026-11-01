import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, appendRowObj, updateRow, asegurarHoja, asegurarColumnas } from '@/lib/sheets';
import {
  HOJA_ARTICULOS_VENTA, HEADERS_ARTICULOS_VENTA, validarClave,
  type FilaArticuloVenta,
} from '@/lib/articulosVenta';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Alta y edición de artículos de venta. Solo admin: define qué se puede vender y con qué
// nombre sale en la factura de Xubio.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede cambiar los artículos de venta.' }, { status: 403 });

  try {
    const body = await req.json();
    const accion = String(body.accion || 'crear');
    const key = String(body.key || '').trim();

    await asegurarHoja(HOJA_ARTICULOS_VENTA, HEADERS_ARTICULOS_VENTA);
    const filas = await readSheet<FilaArticuloVenta>(HOJA_ARTICULOS_VENTA).catch(() => [] as FilaArticuloVenta[]);

    // ── Editar: todo menos la clave ───────────────────────────────────────────────────
    //
    // La clave es el nombre de la columna donde están guardadas las ventas ya cargadas.
    // Cambiarla no renombra esa columna: deja las ventas viejas colgadas de una columna que
    // ya nadie lee, y valen $0 desde ese momento. Por eso se puede cambiar el nombre que se
    // muestra, el de Xubio, el color y si está activo — la clave no.
    if (accion === 'editar' || accion === 'baja' || accion === 'alta') {
      const fila = filas.find((f) => String(f.key).trim() === key);
      if (!fila) return NextResponse.json({ error: 'No se encontró ese artículo.' }, { status: 404 });

      const updates: Record<string, any> = {};
      if (accion === 'baja') updates.activo = 'NO';
      else if (accion === 'alta') updates.activo = 'SI';
      else {
        if (body.label !== undefined) updates.label = String(body.label).trim();
        if (body.label_largo !== undefined) updates.label_largo = String(body.label_largo).trim();
        if (body.xubio !== undefined) {
          const x = String(body.xubio).trim();
          if (!x) return NextResponse.json({ error: 'El nombre en Xubio no puede quedar vacío: sin eso la venta se carga bien y la factura sale sin ese ítem.' }, { status: 400 });
          updates.xubio = x;
        }
        if (body.color !== undefined) updates.color = String(body.color).trim();
        if (body.orden !== undefined) updates.orden = Number(body.orden) || 0;
        if (body.notas !== undefined) updates.notas = String(body.notas).trim();
        if (body.seccion_aparte !== undefined) updates.seccion_aparte = body.seccion_aparte ? 'SI' : 'NO';
      }
      const ok = await updateRow(HOJA_ARTICULOS_VENTA, 'key', key, updates);
      if (!ok) return NextResponse.json({ error: 'No se pudo guardar.' }, { status: 500 });
      return NextResponse.json({ ok: true, key });
    }

    // ── Crear ─────────────────────────────────────────────────────────────────────────
    const errClave = validarClave(key);
    if (errClave) return NextResponse.json({ error: errClave }, { status: 400 });
    if (filas.some((f) => String(f.key).trim() === key)) {
      return NextResponse.json({ error: `Ya existe un artículo con la clave "${key}".` }, { status: 400 });
    }

    const label = String(body.label || '').trim();
    if (!label) return NextResponse.json({ error: 'Poné un nombre corto para el artículo.' }, { status: 400 });
    const xubio = String(body.xubio || '').trim();
    // Sin el nombre de Xubio el artículo se puede cargar y no se puede facturar, y eso no
    // falla: la factura sale sin ese ítem y el cliente paga de menos. Es obligatorio.
    if (!xubio) return NextResponse.json({ error: 'Poné el nombre EXACTO del producto en Xubio. Si no coincide, la venta se carga bien pero la factura sale sin ese ítem.' }, { status: 400 });
    const unidad = String(body.unidad || 'unidad').trim().toLowerCase() === 'kg' ? 'kg' : 'unidad';

    // Las columnas se crean ANTES de dar de alta el artículo, no la primera vez que alguien
    // intenta cargarle una venta. Si el alta quedara sin columnas, el artículo aparecería en
    // la pantalla de carga y la venta se guardaría en el aire.
    await asegurarColumnas('Ventas', [key]);
    await asegurarColumnas('Precios', [key]);
    // Los pedidos fijos también llevan una columna por artículo: sin esto, un producto nuevo
    // no se puede dejar como pedido recurrente y hay que cargarlo a mano todas las semanas.
    await asegurarColumnas('PedidosFijos', [key]).catch(() => {});

    const maxOrden = filas.reduce((m, f) => Math.max(m, Number(f.orden) || 0), 0);
    await appendRowObj(HOJA_ARTICULOS_VENTA, {
      key,
      label,
      label_largo: String(body.label_largo || '').trim() || label,
      xubio,
      unidad,
      activo: 'SI',
      color: /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? String(body.color) : '#0f766e',
      seccion_aparte: body.seccion_aparte === false ? 'NO' : 'SI',
      orden: maxOrden + 1,
      notas: String(body.notas || '').trim(),
      usuario: user.email,
      fecha_alta: new Date().toISOString().slice(0, 10),
    });

    return NextResponse.json({ ok: true, key, columnas: ['Ventas', 'Precios', 'PedidosFijos'] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
