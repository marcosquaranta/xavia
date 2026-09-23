import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { getCuentas, getCobranzas, getComprobantes, importeCobranza, getClientesXubio, getCircuitosContables, circuitoPorDefecto, diagnosticoCuentas } from '@/lib/xubio';
import { sumarDias } from '@/lib/recordatoriosCobro';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Prueba de punta a punta de TODO el camino a Xubio, sin escribir nada: token, cuentas,
// clientes, comprobantes y cobranzas. Es la verificación que se puede correr cuando uno
// quiera, porque no deja rastro — la única parte que no cubre es el POST del cobro, que
// por definición crea un asiento y tiene que ser un cobro real.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pasos: { paso: string; ok: boolean; detalle: string }[] = [];
  const push = (paso: string, ok: boolean, detalle: string) => pasos.push({ paso, ok, detalle });
  let cuentas: { id: number; nombre: string; codigo: string }[] = [];
  let avisoCuentas: string | undefined;

  try {
    const cli = await getClientesXubio();
    push('Credenciales y token', true, `OK — la API respondió con ${cli.length} clientes`);
  } catch (e: any) {
    push('Credenciales y token', false, e?.message || 'no se pudo autenticar');
    return NextResponse.json({ ok: false, pasos, cuentas });
  }

  const hoy = fechaArgentinaHoy();
  const desde = sumarDias(hoy, -60);
  try {
    const comps = await getComprobantes(desde, hoy);
    const total = comps.reduce((a: number, c: any) => a + (Number(c?.importetotal) || 0), 0);
    push('Comprobantes (últimos 60 días)', true, `${comps.length} comprobantes · $${Math.round(total).toLocaleString('es-AR')}`);
  } catch (e: any) {
    push('Comprobantes (últimos 60 días)', false, e?.message || 'error');
  }

  // Las cobranzas van ANTES que las cuentas a propósito: si Xubio no expone el plan de
  // cuentas (404 en este plan), las cuentas salen justamente de acá.
  let cobs: any[] = [];
  try {
    cobs = await getCobranzas(desde, hoy);
    const total = cobs.reduce((a: number, c: any) => a + importeCobranza(c), 0);
    push('Cobranzas (últimos 60 días)', true,
      `${cobs.length} cobranzas · $${Math.round(total).toLocaleString('es-AR')}` +
      (cobs.length === 0 ? ' — sin cobranzas cargadas en Xubio en este período' : ''));
  } catch (e: any) {
    push('Cobranzas (últimos 60 días)', false, e?.message || 'error');
  }

  try {
    const r = await getCuentas(cobs);
    cuentas = r.cuentas;
    avisoCuentas = r.aviso;
    // Se nombran las cuentas encontradas: "solo aparece Brubank" es un síntoma que hay
    // que poder ver acá, no descubrir al intentar registrar un cobro.
    const nombres = cuentas.map((c) => c.nombre).join(', ');
    push('Cuentas donde imputar el cobro', cuentas.length > 0,
      cuentas.length > 0
        ? `${cuentas.length} cuentas · origen: ${r.origen} · ${nombres}`
        : 'no se pudo armar la lista de cuentas — sin plan de cuentas por API y sin cobranzas de las cuales deducirlas');
    // Y qué contestó cada forma de pedirlo, para saber si falta una cuenta porque Xubio no
    // la da o porque nunca entró un cobro en ella.
    push('Plan de cuentas — qué contesta Xubio', true, await diagnosticoCuentas().catch(() => 'no se pudo consultar'));
  } catch (e: any) {
    push('Cuentas donde imputar el cobro', false, e?.message || 'error');
  }

  // Xubio lo exige al crear la cobranza y no asume ninguno por defecto: si falta, el cobro
  // se rechaza con "El campo CircuitoContable esta vacío o es nulo".
  try {
    const circuitos = await getCircuitosContables();
    push('Circuito contable (lo exige la cobranza)', circuitos.length > 0,
      circuitos.length > 0
        ? `${circuitos.length} · se va a usar "${circuitoPorDefecto(circuitos)?.nombre}"`
        : 'Xubio no devolvió ningún circuito contable activo — sin eso no se puede crear la cobranza');
  } catch (e: any) {
    push('Circuito contable (lo exige la cobranza)', false, e?.message || 'error');
  }

  return NextResponse.json({ ok: pasos.every((p) => p.ok), pasos, cuentas, avisoCuentas });
}
