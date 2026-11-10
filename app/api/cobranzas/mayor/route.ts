import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { nombreClienteComprobante, sumarDias } from '@/lib/recordatoriosCobro';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import { importeCobranza } from '@/lib/xubio';
import { comprobantesParaMirar, cobranzasParaMirar } from '@/lib/xubioLectura';
import { leerSaldadas, numerosSaldados } from '@/lib/facturasSaldadas';
import { leerAjustes, ajustesPorFactura } from '@/lib/ajusteFactura';
import { claveComprobante } from '@/lib/comprobantes';
import { cuentaDeCobranza } from '@/lib/xubioCache';
import { libroMayorCliente } from '@/lib/libroMayorCliente';
import type { ClienteVenta } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const norm = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

// ── El libro mayor de un cliente, a pedido ───────────────────────────────────────────
//
// A pedido y no precargado: el detalle de todos los clientes es exactamente lo que hacía
// lenta la pantalla de Cobranzas —el peso no está en calcularlo sino en transferirlo— y
// el mayor se mira de a un cliente por vez, cuando hay algo que discutir.
//
// La ventana son los mismos 365 días que usa el resto de la pantalla. No es estético: lo
// que se da por cubierto se calcula imputando los cobros de la factura más vieja a la más
// nueva, y con otra ventana se ven otros cobros y otras facturas. Dos vistas de la misma
// pantalla contradiciéndose es peor que cualquiera de las dos sola.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const idControl = url.searchParams.get('id_control') || '';
  if (!idControl) return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 });
  const dias = Math.min(365, Math.max(30, Number(url.searchParams.get('dias')) || 365));
  // Solo para comparar y explicar la diferencia. No entra en ningún cálculo del mayor.
  const deudaParam = url.searchParams.get('deuda');
  const deudaAbierta = deudaParam === null || deudaParam === '' ? undefined : Number(deudaParam);

  try {
    const clientes = await readSheet<ClienteVenta>('Clientes');
    const cli = clientes.find((c) => String(c.id_control) === idControl);
    if (!cli) return NextResponse.json({ error: 'No se encontró el cliente.' }, { status: 404 });

    const hoy = fechaArgentinaHoy();
    const desde = sumarDias(hoy, -dias);
    const [comps, cobranzas, saldadasFilas, ajustesRaw] = await Promise.all([
      comprobantesParaMirar(desde, hoy),
      cobranzasParaMirar(desde, hoy),
      leerSaldadas(),
      leerAjustes(),
    ]);

    const saldadas = numerosSaldados(saldadasFilas);
    const ajustes = ajustesPorFactura(ajustesRaw);
    const k = norm(cli.nombre_xubio || cli.nombre_display);
    const delCliente = (c: any) => norm(nombreClienteComprobante(c)) === k;

    const facturas = comps
      .filter((c: any) => Number(c?.tipo) === 1 && delCliente(c))
      .map((c: any) => {
        const numero = String(c?.numeroDocumento || '').trim();
        const importeXubio = Number(c?.importetotal) || 0;
        const aj = ajustes.get(claveComprobante(numero));
        return {
          numero,
          fecha: soloFecha(c?.fecha),
          // Lo que hay que cobrar, no lo que dice el comprobante: si la venta se corrigió
          // después de emitir, el mayor tiene que mostrar la deuda real.
          importe: aj ? aj.importeApp : importeXubio,
          importeFactura: importeXubio,
          ajustada: !!aj,
          saldadaManual: saldadas.has(claveComprobante(numero)),
        };
      })
      .filter((f) => f.numero);

    // Las notas de crédito bajan la deuda sin que entre plata. Dejarlas afuera hace que el
    // mayor muestre como debida una factura que ya se anuló.
    const notas = comps
      .filter((c: any) => Number(c?.tipo) === 3 && delCliente(c))
      .map((c: any) => ({
        numero: String(c?.numeroDocumento || '').trim(),
        fecha: soloFecha(c?.fecha),
        importe: Number(c?.importetotal) || 0,
      }));

    // TODAS las cobranzas del cliente, estén imputadas o no. El mayor suma y resta: una
    // cobranza que ya se imputó a facturas concretas igual entró como plata, y sacarla
    // dejaría el saldo diciendo que el cliente debe algo que ya pagó.
    const cobros = cobranzas
      .filter((cob: any) => delCliente(cob))
      .map((cob: any) => ({
        fecha: soloFecha(cob?.fecha),
        importe: importeCobranza(cob),
        numero: String(cob?.numeroDocumento || cob?.numero || '').trim(),
        cuenta: cuentaDeCobranza(cob),
      }));

    const mayor = libroMayorCliente({ facturas, notas, cobros, desde, hasta: hoy, deudaAbierta });
    return NextResponse.json({ ok: true, cliente: cli.nombre_display || cli.nombre_xubio, dias, ...mayor });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'No se pudo armar el libro mayor.' }, { status: 500 });
  }
}
