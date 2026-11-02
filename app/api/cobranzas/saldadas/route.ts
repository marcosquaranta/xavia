import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { marcarSaldadas, revertirSaldada } from '@/lib/facturasSaldadas';
import { facturasAntiguas, paraMarcar } from '@/lib/saldarAntiguas';

// Marcar facturas como saldadas sin generar ningún movimiento en Xubio, y deshacerlo.
//
// Es admin y nada más: dar una factura por cobrada la saca de los reclamos y de las
// opciones al imputar, así que no es una preferencia de pantalla, es una decisión sobre
// plata que se deja de perseguir.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  try {
    const body = await req.json();

    if (body?.accion === 'revertir') {
      const numero = String(body?.numero || '').trim();
      if (!numero) return NextResponse.json({ error: 'Falta el número de factura.' }, { status: 400 });
      await revertirSaldada(numero, user.email);
      return NextResponse.json({ ok: true, mensaje: `${numero} vuelve a la lista de pendientes.` });
    }

    // ── Barrer todo lo viejo de una sola vez ──────────────────────────────────────────
    //
    // La lista se vuelve a calcular ACÁ y no se toma la que mandó el navegador. La pantalla
    // manda cuántas facturas creía que iban, y si el número no coincide se corta: entre que
    // se miró la vista previa y se apretó el botón alguien pudo registrar un cobro, y marcar
    // como saldada una factura que acaba de cobrarse la esconde sin que nadie se entere.
    //
    // Es la diferencia entre confirmar una cantidad y confirmar una lista. Lo que se
    // confirma es la cantidad; la lista la arma el servidor.
    if (body?.accion === 'saldar_antiguas') {
      const dias = Math.min(365, Math.max(0, Number(body?.dias) || 0));
      if (!dias) return NextResponse.json({ error: 'Decí desde cuántos días de antigüedad.' }, { status: 400 });
      const motivoMasivo = String(body?.motivo || '').trim();
      if (!motivoMasivo) return NextResponse.json({ error: 'Escribí por qué se dan por saldadas.' }, { status: 400 });

      const soloEstos = Array.isArray(body?.clientes) ? body.clientes.map(String) : undefined;
      const r = await facturasAntiguas(dias);
      const lista = paraMarcar(r, soloEstos);
      if (!lista.length) {
        return NextResponse.json({ error: `No quedó ninguna factura abierta de más de ${dias} días.` }, { status: 400 });
      }
      // La pantalla dice cuántas esperaba. Si cambió, se frena y se explica, en vez de
      // marcar un número distinto del que se confirmó.
      const esperadas = Number(body?.esperadas);
      if (esperadas > 0 && esperadas !== lista.length) {
        return NextResponse.json({
          error: `Cambió algo desde que miraste: ahora son ${lista.length} facturas y no ${esperadas}. Volvé a ver la lista antes de marcar.`,
          recalcular: true, ahora: lista.length,
        }, { status: 409 });
      }

      const res = await marcarSaldadas({ facturas: lista, motivo: motivoMasivo, usuario: user.email });
      const total = lista.reduce((a, f) => a + (Number(f.importe) || 0), 0);
      const partes = [`${res.marcadas} ${res.marcadas === 1 ? 'factura marcada' : 'facturas marcadas'} como saldadas`];
      if (res.yaEstaban) partes.push(`${res.yaEstaban} ya estaban`);
      partes.push(`$${Math.round(total).toLocaleString('es-AR')} en ${r.clientes.length} ${r.clientes.length === 1 ? 'cliente' : 'clientes'}`);
      return NextResponse.json({
        ok: true, ...res, total, dias,
        mensaje: `${partes.join(' · ')}. No se registró ningún movimiento en Xubio.`,
      });
    }

    const facturas = Array.isArray(body?.facturas) ? body.facturas : [];
    if (!facturas.length) return NextResponse.json({ error: 'No se eligió ninguna factura.' }, { status: 400 });
    // El motivo es obligatorio a propósito: dentro de seis meses, "por qué esta factura no
    // se reclama más" no se puede reconstruir de ningún otro lado.
    const motivo = String(body?.motivo || '').trim();
    if (!motivo) return NextResponse.json({ error: 'Escribí por qué se dan por saldadas.' }, { status: 400 });

    const r = await marcarSaldadas({ facturas, motivo, usuario: user.email });
    const partes = [`${r.marcadas} ${r.marcadas === 1 ? 'factura marcada' : 'facturas marcadas'} como saldadas`];
    if (r.yaEstaban) partes.push(`${r.yaEstaban} ya estaban`);
    return NextResponse.json({ ok: true, ...r, mensaje: `${partes.join(' · ')}. No se registró ningún movimiento en Xubio.` });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'No se pudo guardar.' }, { status: 500 });
  }
}
