import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import { getComprobantes } from '@/lib/xubio';
import { nombreClienteComprobante, sumarDias } from '@/lib/recordatoriosCobro';
import { HOJA_COBROS, type CobroRegistrado } from '@/lib/cobros';
import { HOJA_RECORDATORIOS, type RecordatorioCobro } from '@/lib/recordatoriosCobro';
import { fechaArgentinaHoy } from '@/lib/ocupacion';
import type { ClienteVenta } from '@/lib/types';

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
  const dias = Math.min(365, Math.max(30, Number(new URL(req.url).searchParams.get('dias')) || 120));

  try {
    const clientes = await readSheet<ClienteVenta>('Clientes');
    const cli = clientes.find((c) => String(c.id_control) === idControl);
    if (!cli) return NextResponse.json({ error: 'No se encontró el cliente.' }, { status: 404 });

    const hoy = fechaArgentinaHoy();
    const desde = sumarDias(hoy, -dias);
    const [comps, cobros, reclamos] = await Promise.all([
      getComprobantes(desde, hoy),
      readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => [] as CobroRegistrado[]),
      readSheet<RecordatorioCobro>(HOJA_RECORDATORIOS).catch(() => [] as RecordatorioCobro[]),
    ]);

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

    const yaCobradas = new Set<string>();
    for (const c of cobros) {
      if (String(c.estado) === 'anulado') continue;
      for (const n of String((c as any).comprobantes || '').split(',')) {
        const t = n.trim();
        if (t) yaCobradas.add(t);
      }
    }

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
      facturas: facturas.map((f) => ({
        ...f,
        yaCobrada: yaCobradas.has(f.numero),
        reclamadaEl: reclamadas.get(f.numero) || '',
      })),
      notasCredito: Math.round(notasCredito),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
