import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { getComprobantes } from '@/lib/xubio';
import { nombreClienteComprobante, sumarDias } from '@/lib/recordatoriosCobro';
import { HOJA_COBROS, type CobroRegistrado } from '@/lib/cobros';
import { HOJA_RECORDATORIOS, type RecordatorioCobro } from '@/lib/recordatoriosCobro';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { ClienteVenta } from '@/lib/types';

import { getCobranzas, importeCobranza } from '@/lib/xubio';
import { leerSaldadas, numerosSaldados } from '@/lib/facturasSaldadas';
import { claveComprobante } from '@/lib/comprobantes';
import { cubrirConCobrosDeXubio } from '@/lib/facturasCliente';
import { comprobantesParaMirar, cobranzasParaMirar } from '@/lib/xubioLectura';
import { leerEdiciones, imputacionesManuales } from '@/lib/cobranzasEdit';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const norm = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

// Facturas de un cliente para elegir al registrar un cobro: de la más reciente a la más
// vieja, con fecha e importe. Marca las que ya fueron cubiertas por un cobro cargado desde
// la app — no es lo mismo que "paga" (Xubio no expone eso), es "la app ya la contó", que
// alcanza para no cobrarla dos veces desde acá.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const idControl = new URL(req.url).searchParams.get('id_control') || '';
  if (!idControl) return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 });
  // 365 días, la misma ventana que usa la pantalla de Cobranzas (DIAS_PAGINA). No es un
  // detalle estético: lo que se da por cubierto se calcula imputando los cobros del cliente
  // de la factura más vieja a la más nueva, y con 120 días se ven menos cobros y menos
  // facturas que con 365. El reparto da distinto y la MISMA factura aparece cobrada en una
  // lista y abierta en la otra — dos listas de la misma pantalla contradiciéndose es peor
  // que cualquiera de las dos por separado.
  const dias = Math.min(365, Math.max(30, Number(new URL(req.url).searchParams.get('dias')) || 365));

  try {
    const clientes = await readSheet<ClienteVenta>('Clientes');
    const cli = clientes.find((c) => String(c.id_control) === idControl);
    if (!cli) return NextResponse.json({ error: 'No se encontró el cliente.' }, { status: 404 });

    const hoy = fechaArgentinaHoy();
    const desde = sumarDias(hoy, -dias);
    const [comps, cobros, reclamos, cobranzas, saldadasFilas, edicionesRaw] = await Promise.all([
      comprobantesParaMirar(desde, hoy),
      readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => [] as CobroRegistrado[]),
      readSheet<RecordatorioCobro>(HOJA_RECORDATORIOS).catch(() => [] as RecordatorioCobro[]),
      cobranzasParaMirar(desde, hoy),
      leerSaldadas(),
      leerEdiciones(),
    ]);
    const saldadas = numerosSaldados(saldadasFilas);
    // Las imputaciones hechas a mano. Van por el mismo camino que en la pantalla de
    // Cobranzas: si acá se decidieran distinto, la misma factura figuraría cobrada en una
    // lista y abierta en la otra, que es exactamente el lío que esto viene a terminar.
    const imputadas = imputacionesManuales(edicionesRaw, claveComprobante);

    const k = norm(cli.nombre_xubio || cli.nombre_display);
    const facturas = comps
      .filter((c: any) => Number(c?.tipo) === 1 && norm(nombreClienteComprobante(c)) === k)
      .map((c: any) => ({
        numero: String(c?.numeroDocumento || '').trim(),
        fecha: soloFecha(c?.fecha),
        importe: Number(c?.importetotal) || 0,
      }))
      .filter((f) => f.numero)
      // De la más reciente a la más vieja, que es como se las busca al cobrar.
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    // Las notas de crédito del período, para poder avisar que el saldo no es la suma simple.
    const notasCredito = comps
      .filter((c: any) => Number(c?.tipo) === 3 && norm(nombreClienteComprobante(c)) === k)
      .reduce((a: number, c: any) => a + (Number(c?.importetotal) || 0), 0);

    // Por CLAVE y no por texto literal, igual que la precarga: el mismo comprobante escrito
    // distinto no se reconocía y una factura ya cobrada se seguía ofreciendo como abierta.
    const yaCobradas = new Set<string>();
    for (const c of cobros) {
      if (String(c.estado) === 'anulado') continue;
      for (const n of String((c as any).comprobantes || '').split(',')) {
        const k2 = claveComprobante(n);
        if (k2) yaCobradas.add(k2);
      }
    }

    // Cuánto cobró este cliente según Xubio, para dar por cubiertas las más viejas — misma
    // reconstrucción que usa la pantalla de Cobranzas. Sin esto, pedir las facturas de un
    // cliente a mano devolvía como abiertas las que la precarga ya daba por cubiertas, y
    // los dos caminos mostraban cosas distintas para el mismo cliente.
    // Los cobros cuya imputación ya está dicha no entran: su plata está asignada a facturas
    // concretas y dejarla en el pozo la contaría dos veces, tapando otras que siguen
    // abiertas. Mismo criterio que facturasPorCliente.
    const explicadas = new Set<string>(imputadas.transaccionesImputadas);
    for (const c of cobros) {
      if (String(c.estado) === 'anulado') continue;
      if (!String((c as any).comprobantes || '').trim()) continue;
      const tid = String((c as any).transaccionid || '').trim();
      if (tid) explicadas.add(tid);
    }
    const cobradoTotal = cobranzas
      .filter((cob: any) => norm(nombreClienteComprobante(cob)) === k)
      .filter((cob: any) => !explicadas.has(String(cob?.transaccionid || '').trim()))
      .reduce((a: number, cob: any) => a + importeCobranza(cob), 0);

    // Cuándo se reclamó cada factura (si se reclamó): al armar un reclamo manual es el
    // dato que evita mandar dos veces lo mismo sin darse cuenta.
    const reclamadas = new Map<string, string>();
    for (const r of reclamos) {
      if (String(r.estado) !== 'enviado') continue;
      const cuando = soloFecha(r.fecha_envio);
      for (const n of String(r.comprobantes || '').split(',')) {
        const t = n.trim();
        if (t && (!reclamadas.has(t) || cuando > reclamadas.get(t)!)) reclamadas.set(t, cuando);
      }
    }

    return NextResponse.json({
      ok: true,
      cliente: cli.nombre_display || cli.nombre_xubio,
      dias,
      facturas: cubrirConCobrosDeXubio(
        facturas.map((f) => ({
          ...f,
          yaCobrada: yaCobradas.has(claveComprobante(f.numero)),
          saldadaManual: saldadas.has(claveComprobante(f.numero)),
          imputadaManual: imputadas.porFactura.has(claveComprobante(f.numero)),
        })),
        cobradoTotal,
      ).map((f) => ({ ...f, reclamadaEl: reclamadas.get(f.numero) || '' })),
      notasCredito: Math.round(notasCredito),
      // Lo cobrado que todavía NO está asignado a ninguna factura: es la plata que la app
      // reparte sola, y por lo tanto lo único que explica qué figura cubierto por deducción.
      cobradoTotal: Math.round(cobradoTotal),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
