import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { getComprobantes } from '@/lib/xubio';
import { sumarDias } from '@/lib/recordatoriosCobro';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Cómo es una nota de crédito en Xubio ──────────────────────────────────────────────
//
// Antes de poder emitir una NC desde la app hay que saber qué espera Xubio: si la emite el
// mismo endpoint que la factura con otro `tipo`, con qué punto de venta sale, y —lo único
// que de verdad no se puede adivinar— CÓMO se referencia la factura original. AFIP exige el
// comprobante asociado, pero el nombre del campo en el bean de Xubio no está documentado en
// ningún lado que podamos leer.
//
// Esto lo averigua sin escribir nada: busca las notas de crédito que ya se emitieron (tipo 3)
// y devuelve una entera, con todas sus claves. Lo que haya ahí adentro ES el contrato — una NC
// que Xubio aceptó alguna vez dice, campo por campo, qué hay que mandarle.
//
// Es el mismo camino que resolvió el problema de las retenciones: cuando no se puede probar
// contra producción, el diagnóstico tiene que traer la respuesta, no el síntoma.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dias = Math.min(730, Math.max(30, Number(new URL(req.url).searchParams.get('dias')) || 365));
  const hoy = fechaArgentinaHoy();
  const desde = sumarDias(hoy, -dias);

  try {
    const comps = await getComprobantes(desde, hoy);
    const notas = comps.filter((c: any) => Number(c?.tipo) === 3);
    const facturas = comps.filter((c: any) => Number(c?.tipo) === 1);

    if (!notas.length) {
      return NextResponse.json({
        ok: true, desde, hasta: hoy,
        notasEncontradas: 0,
        facturasEncontradas: facturas.length,
        conclusion: 'No hay ninguna nota de crédito emitida en el período, así que no hay de dónde sacar la forma del bean. '
          + 'Probá con ?dias=730, o emití una a mano en Xubio y volvé a correr esto: con una sola alcanza.',
        // La factura sirve igual como referencia de qué campos trae un comprobante de venta.
        ejemploDeFactura: facturas[0] ?? null,
      });
    }

    // Todas las claves que aparecen en alguna NC, para no perder un campo que una traiga y
    // otra no (una NC sin retención, por ejemplo, puede no traer el campo).
    const claves = new Set<string>();
    for (const n of notas) for (const k of Object.keys(n || {})) claves.add(k);

    // Las claves que una NC tiene y una factura no: ahí está, casi seguro, la referencia al
    // comprobante original, que es el único dato que no se puede deducir.
    const clavesFactura = new Set<string>();
    for (const f of facturas) for (const k of Object.keys(f || {})) clavesFactura.add(k);
    const soloEnNC = [...claves].filter((k) => !clavesFactura.has(k));

    const nota = notas[notas.length - 1];
    return NextResponse.json({
      ok: true, desde, hasta: hoy,
      notasEncontradas: notas.length,
      facturasEncontradas: facturas.length,
      // Lo importante: el bean entero de una NC real.
      ejemploDeNotaDeCredito: nota,
      clavesDeLasNotas: [...claves].sort(),
      clavesQueSoloTienenLasNotas: soloEnNC,
      puntosDeVenta: [...new Set(notas.map((n: any) => String(n?.numeroDocumento || '').slice(0, 6)))],
      conclusion: soloEnNC.length
        ? `Mirá "clavesQueSoloTienenLasNotas": ${soloEnNC.join(', ')}. Ahí está la referencia a la factura original.`
        : 'Las notas no traen ninguna clave que las facturas no tengan. O la referencia viaja dentro de un campo '
          + 'que las dos comparten, o Xubio no la expone al leer — en ese caso hay que mirar una NC en la pantalla de Xubio '
          + 'y ver si muestra el comprobante asociado.',
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'server_error' }, { status: 500 });
  }
}
