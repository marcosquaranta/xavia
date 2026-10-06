import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { getCuentas, getCobranzas, getComprobantes, importeCobranza, getClientesXubio, getCircuitosContables, circuitoPorDefecto, diagnosticoCuentas, xubioGet } from '@/lib/xubio';
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

  // Cómo arma Xubio una cobranza que YA tiene retención.
  //
  // La cuenta "Retención Ganancias Sufrida" está bien categorizada en Xubio: es un crédito
  // fiscal (Activo Corriente > Otros Créditos), no una cuenta de caja. Por eso Xubio la
  // rechaza como MEDIO DE COBRO: no es que la cuenta esté mal, es que la estamos mandando
  // por el campo equivocado. La retención no es plata que entró, es una factura cancelada
  // sin plata, y Xubio la debe guardar en otro lado del mismo documento.
  //
  // Esto busca ese otro lado. No asume que la retención esté en los instrumentos de cobro:
  // recorre la cobranza ENTERA buscando cualquier campo que mencione retención, y lista las
  // claves de primer nivel. Si estuviera en un array aparte —`transaccionRetencion`, el
  // nombre que sea— con el filtro anterior no se habría encontrado nunca.
  try {
    const mencionaRetencion = (v: any): boolean => {
      if (v === null || v === undefined) return false;
      if (typeof v === 'string') return /retenc|percep/i.test(v);
      if (typeof v !== 'object') return false;
      return Object.entries(v).some(([k, x]) => /retenc|percep/i.test(k) || mencionaRetencion(x));
    };
    const conRet = cobs.filter(mencionaRetencion);
    const claves = cobs.length ? Object.keys(cobs[0]).join(', ') : '(sin cobranzas)';
    push('Cómo guarda Xubio una cobranza con retención', conRet.length > 0,
      conRet.length === 0
        ? `Ninguna de las ${cobs.length} cobranzas de los últimos 60 días menciona una retención por ningún lado. `
          + `Campos que trae una cobranza: ${claves}. `
          + 'Si cargaste alguna con retención a mano, puede ser que tenga más de 60 días, o que Xubio no devuelva ese dato por la API.'
        : `${conRet.length} de ${cobs.length} cobranzas mencionan retención. La más reciente, cruda y completa:
`
          + JSON.stringify(conRet[conRet.length - 1], null, 1).slice(0, 6000));
  } catch (e: any) {
    push('Cómo guarda Xubio una cobranza con retención', false, e?.message || 'error');
  }

  // ¿Dónde guarda Xubio las retenciones sufridas?
  //
  // No están en la cobranza: el bean que devuelve la API trae solo los instrumentos de
  // cobro, y ahí no entran — Xubio exige que un instrumento apunte a una cuenta que
  // impacte en disponibilidades, y una retención es un crédito fiscal, no plata.
  //
  // Entonces deben vivir en otro documento. Esto prueba nombres candidatos de endpoint,
  // SOLO LECTURA: un 404 descarta ese nombre, una respuesta muestra la estructura. No
  // escribe nada y se puede correr las veces que haga falta.
  try {
    const candidatos = [
      'retencionBean', 'retencion', 'certificadoRetencionBean', 'certificadoRetencion',
      'retencionSufridaBean', 'retencionesBean', 'comprobanteRetencionBean',
    ];
    const hallazgos: string[] = [];
    for (const nombre of candidatos) {
      try {
        const r = await xubioGet<any>(`${nombre}?fechaDesde=${desde}&fechaHasta=${hoy}`);
        const n = Array.isArray(r) ? r.length : (r ? 1 : 0);
        hallazgos.push(`✓ ${nombre} → EXISTE, ${n} resultado(s)` + (n > 0 ? `. Ejemplo: ${JSON.stringify(Array.isArray(r) ? r[0] : r).slice(0, 1200)}` : ''));
      } catch (e: any) {
        const msg = String(e?.message || '');
        // Un 404 es "no existe ese recurso" y no aporta nada; cualquier otra cosa (400, 500)
        // significa que el endpoint SÍ existe y lo que está mal es cómo se lo llamó.
        if (!/HTTP 404/.test(msg)) hallazgos.push(`? ${nombre} → ${msg} (existe, pero pide otros parámetros)`);
      }
    }
    push('¿Dónde guarda Xubio las retenciones?', hallazgos.length > 0,
      hallazgos.length === 0
        ? `Ninguno de los nombres probados existe (${candidatos.join(', ')}). Hay que pedirle a Xubio el nombre del recurso, o cargar la retención a mano allá.`
        : hallazgos.join('\n'));
  } catch (e: any) {
    push('¿Dónde guarda Xubio las retenciones?', false, e?.message || 'error');
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
