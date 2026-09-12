import { asegurarHoja, asegurarColumna, readSheet, appendRowObj } from './sheets';
import { getComprobantes, getCobranzas, importeCobranza } from './xubio';
import { fechaArgentinaHoy } from './ocupacion';
import type { ClienteVenta } from './types';

// ── Recordatorios de cobro ────────────────────────────────────────────────────────────
//
// Un mail por semana a cada cliente elegido, con TODAS las facturas que se le emitieron
// en la semana — no un mail por factura, que a un cliente que compra tres veces por semana
// le llegarían tres reclamos. Se activa cliente por cliente: hay clientes a los que hay
// que recordarles siempre y otros a los que sería una ofensa.
//
// LÍMITE DE XUBIO, verificado contra su especificación OpenAPI (sept-2026): NO se puede
// saber si una factura puntual está paga. `comprobanteVentaBean` tiene 43 campos y ninguno
// es saldo/estado/pagado, y las cobranzas (`cobranzaBean`) no traen a qué comprobante se
// imputan. Lo que sí se puede es sumar lo facturado y lo cobrado por cliente en una
// ventana de tiempo: con eso alcanza para NO escribirle a alguien que está al día, que es
// el error caro. Un saldo menor o igual a cero frena el recordatorio.
//
// La otra defensa es el registro: cada comprobante entra en UN solo recordatorio, para
// siempre. Si el cron falla un día, esas facturas siguen sin avisar y entran al día
// siguiente; lo que nunca pasa es que le llegue dos veces el mismo reclamo al cliente.

export const HOJA_RECORDATORIOS = 'RecordatoriosCobro';
export const HEADERS_RECORDATORIOS = [
  'id_recordatorio', 'fecha_envio', 'id_control', 'cliente', 'comprobantes',
  'importe', 'fecha_factura', 'destinatarios', 'estado', 'detalle', 'usuario',
];

export interface RecordatorioCobro {
  id_recordatorio: string;
  fecha_envio: string;    // ISO
  id_control: string;
  cliente: string;
  comprobantes: string;   // números separados por coma
  importe: number | string;
  fecha_factura: string;  // YYYY-MM-DD de las facturas recordadas
  destinatarios: string;
  estado: 'enviado' | 'error' | 'sin_saldo' | 'pagado' | string;
  detalle: string;
  usuario: string;        // 'cron' o el mail del admin que lo mandó a mano
}

// Columnas nuevas en la hoja Clientes (se agregan solas con asegurarColumna).
export const COL_ACTIVO = 'recordatorio_cobro';   // 'SI' para prender el recordatorio
export const COL_EMAIL = 'email_cobranza';        // si está vacío cae al `email` de siempre
// La corrida es semanal (lunes a la mañana, ver vercel.json). La ventana mira 14 días y no
// 7 a propósito: si una semana falla el cron, esas facturas siguen sin recordar y entran en
// la corrida siguiente en vez de perderse para siempre. Como cada comprobante entra en un
// único recordatorio, mirar de más nunca duplica un reclamo.
export const DIAS_VENTANA = 14;

// Datos bancarios del mail. Van en Configuracion para poder cambiarlos sin tocar código,
// pero arrancan cargados: un recordatorio de pago sin decir a dónde pagar no sirve.
export const CONFIG_DATOS_PAGO = 'cobranza_datos_pago';
export const DATOS_PAGO_DEFAULT = [
  'Titular: Xavia',
  'Banco: Brubank',
  'CBU: 1430001725045405490013',
  'Alias: xavia.life.srl',
  'Nº de cuenta: 2504540549001',
  'CUIT: 30-71840929-9',
].join('\n');

// Ventana para el saldo. 120 días cubre de sobra el ciclo de cobro de estos clientes sin
// pedirle a Xubio un año entero de comprobantes en cada corrida del cron.
export const DIAS_VENTANA_SALDO = 120;

const norm = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

const d = (f: string) => new Date(f + 'T12:00:00');
const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
export function sumarDias(fecha: string, dias: number): string {
  const dt = d(fecha); dt.setDate(dt.getDate() + dias); return iso(dt);
}
const soloFecha = (v: any) => String(v || '').split(/[T ]/)[0];

export interface ClienteRecordatorio {
  id_control: string;
  nombre: string;      // para mostrar
  nombreXubio: string; // para matchear contra el comprobante
  email: string;
}

// Clientes con el recordatorio prendido Y con mail a dónde mandarlo. Un cliente prendido
// sin mail se devuelve igual en `sinEmail` para poder avisarlo en pantalla en vez de que
// falle en silencio.
export function clientesConRecordatorio(clientes: ClienteVenta[]): { activos: ClienteRecordatorio[]; sinEmail: string[] } {
  const activos: ClienteRecordatorio[] = [];
  const sinEmail: string[] = [];
  for (const c of clientes) {
    const prendido = String((c as any)[COL_ACTIVO] || '').trim().toUpperCase() === 'SI';
    if (!prendido) continue;
    const nombre = c.nombre_display || c.nombre_xubio || c.id_control;
    const email = String((c as any)[COL_EMAIL] || c.email || '').trim();
    if (!email.includes('@')) { sinEmail.push(nombre); continue; }
    activos.push({ id_control: c.id_control, nombre, nombreXubio: c.nombre_xubio || nombre, email });
  }
  return { activos, sinEmail };
}

export interface FacturaPendiente {
  numero: string;
  fecha: string;
  importe: number;
}

export interface EnvioRecordatorio {
  cliente: ClienteRecordatorio;
  facturas: FacturaPendiente[];
  total: number;
  saldoCliente: number | null; // facturado − cobrado en la ventana; null si no se pudo calcular
}

export interface EnvioOmitido {
  cliente: string;
  motivo: string;
}

// Nombre del cliente en un comprobante de Xubio (viene como objeto o como string según
// el endpoint).
export function nombreClienteComprobante(c: any): string {
  const cl = c?.cliente;
  if (!cl) return '';
  return String(typeof cl === 'string' ? cl : (cl.nombre || cl.name || '')).trim();
}

// Saldo por cliente (normalizado) = facturado − cobrado en la ventana. Positivo = debe.
export function calcularSaldos(comprobantes: any[], cobranzas: any[]): Map<string, number> {
  const saldo = new Map<string, number>();
  for (const c of comprobantes) {
    const k = norm(nombreClienteComprobante(c));
    if (!k) continue;
    // Las notas de crédito (tipo 3) restan: si no, un cliente al que se le anuló una
    // factura figuraría debiendo algo que ya no debe.
    const signo = Number(c?.tipo) === 3 ? -1 : 1;
    saldo.set(k, (saldo.get(k) || 0) + signo * (Number(c?.importetotal) || 0));
  }
  for (const cob of cobranzas) {
    const k = norm(nombreClienteComprobante(cob));
    if (!k) continue;
    saldo.set(k, (saldo.get(k) || 0) - importeCobranza(cob));
  }
  return saldo;
}

// Qué recordatorios corresponde mandar hoy. Función pura: recibe todo ya leído.
export function calcularEnvios(
  hoy: string,
  clientes: ClienteRecordatorio[],
  comprobantes: any[],
  yaEnviados: RecordatorioCobro[],
  saldos: Map<string, number>,
): { envios: EnvioRecordatorio[]; omitidos: EnvioOmitido[] } {
  const envios: EnvioRecordatorio[] = [];
  const omitidos: EnvioOmitido[] = [];

  // Un comprobante entra en un único recordatorio, para siempre.
  const yaRecordados = new Set<string>();
  for (const r of yaEnviados) {
    if (String(r.estado) === 'error') continue; // si falló, se puede reintentar
    for (const n of String(r.comprobantes || '').split(',')) {
      const t = n.trim();
      if (t) yaRecordados.add(t);
    }
  }

  const desdeVentana = sumarDias(hoy, -DIAS_VENTANA);
  for (const cliente of clientes) {
    const k = norm(cliente.nombreXubio);
    const delCliente = comprobantes.filter((c) => {
      if (Number(c?.tipo) !== 1) return false; // solo facturas, no notas de crédito/débito
      if (norm(nombreClienteComprobante(c)) !== k) return false;
      const f = soloFecha(c?.fecha);
      return f >= desdeVentana && f <= hoy;
    });
    if (!delCliente.length) continue;

    const facturas = delCliente
      .map((c) => ({
        numero: String(c?.numeroDocumento || '').trim(),
        fecha: soloFecha(c?.fecha),
        importe: Number(c?.importetotal) || 0,
      }))
      .filter((f) => f.numero && !yaRecordados.has(f.numero))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (!facturas.length) continue;

    // Guarda de saldo: si el cliente está al día en la ventana, no se le escribe. No
    // prueba que ESTA factura esté paga (Xubio no lo dice), pero evita el caso feo de
    // reclamarle a alguien que no debe nada.
    const saldo = saldos.has(k) ? Math.round(saldos.get(k)!) : null;
    if (saldo !== null && saldo <= 0) {
      omitidos.push({ cliente: cliente.nombre, motivo: `sin saldo pendiente (facturado − cobrado = $${saldo.toLocaleString('es-AR')} en los últimos ${DIAS_VENTANA_SALDO} días)` });
      continue;
    }

    envios.push({
      cliente,
      facturas,
      total: facturas.reduce((a, f) => a + f.importe, 0),
      saldoCliente: saldo,
    });
  }
  return { envios, omitidos };
}

const fmtMoneda = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtFecha = (f: string) => { const [y, m, dd] = f.split('-'); return `${dd}/${m}/${y}`; };

export function asuntoRecordatorio(envio: EnvioRecordatorio): string {
  const n = envio.facturas.length;
  return `Recordatorio de pago — ${n === 1 ? `Factura ${envio.facturas[0].numero}` : `${n} comprobantes`} — Xavia`;
}

export function cuerpoRecordatorioHtml(envio: EnvioRecordatorio, datosPago: string): string {
  const filas = envio.facturas.map((f) => `<tr>
      <td style="padding:7px 12px;border-bottom:1px solid #eee">${f.numero}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee">${fmtFecha(f.fecha)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;text-align:right">${fmtMoneda(f.importe)}</td>
    </tr>`).join('');
  const pago = datosPago.split('\n').filter(Boolean)
    .map((l) => `<p style="margin:0;font-size:13px;color:#111">${l}</p>`).join('');
  return `
  <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
    <p style="font-size:14px">Hola, ¿cómo están?</p>
    <p style="font-size:14px">
      Les escribimos para recordarles el vencimiento de ${envio.facturas.length === 1 ? 'el siguiente comprobante' : 'los siguientes comprobantes'}:
    </p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin:14px 0">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:7px 12px;text-align:left">Comprobante</th>
        <th style="padding:7px 12px;text-align:left">Fecha</th>
        <th style="padding:7px 12px;text-align:right">Importe</th>
      </tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr>
        <td colspan="2" style="padding:8px 12px;font-weight:700">Total</td>
        <td style="padding:8px 12px;text-align:right;font-weight:800">${fmtMoneda(envio.total)}</td>
      </tr></tfoot>
    </table>
    ${pago ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:14px 0">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase">Datos para transferir</p>
      ${pago}
    </div>` : ''}
    <p style="font-size:13px;color:#374151">
      Si ya realizaron el pago, por favor ignoren este mensaje y, si pueden, envíennos el comprobante así lo registramos.
      Ante cualquier consulta, respondan este mismo correo.
    </p>
    <p style="font-size:13px;color:#374151">Muchas gracias,<br><strong>Xavia</strong></p>
  </div>`;
}

export function cuerpoRecordatorioTexto(envio: EnvioRecordatorio, datosPago: string): string {
  const L: string[] = ['Hola, ¿cómo están?', ''];
  L.push(`Les recordamos el vencimiento de ${envio.facturas.length === 1 ? 'el siguiente comprobante' : 'los siguientes comprobantes'}:`);
  for (const f of envio.facturas) L.push(`  ${f.numero} · ${fmtFecha(f.fecha)} · ${fmtMoneda(f.importe)}`);
  L.push(`  TOTAL: ${fmtMoneda(envio.total)}`, '');
  if (datosPago.trim()) { L.push('Datos para transferir:'); for (const l of datosPago.split('\n').filter(Boolean)) L.push('  ' + l); L.push(''); }
  L.push('Si ya realizaron el pago, por favor ignoren este mensaje y, si pueden, envíennos el comprobante así lo registramos.');
  L.push('Ante cualquier consulta, respondan este mismo correo.', '', 'Muchas gracias,', 'Xavia');
  return L.join('\n');
}

async function enviarMail(args: { to: string[]; cc?: string[]; asunto: string; html: string; texto: string }): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia <administracion@xavia.com.ar>',
        reply_to: 'administracion@xavia.com.ar',
        to: args.to,
        cc: args.cc && args.cc.length ? args.cc : undefined,
        subject: args.asunto,
        html: args.html,
        text: args.texto,
      }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return { ok: false, error: err?.message || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'error de red' };
  }
}

export const COPIA_INTERNA = ['administracion@xavia.com.ar'];

export interface ResultadoCorrida {
  ok: boolean;
  enviados: number;
  omitidos: EnvioOmitido[];
  sinEmail: string[];
  errores: string[];
  detalle: { cliente: string; comprobantes: string; total: number }[];
}

// Corrida diaria. `soloSimular` arma todo y no manda nada — para la vista previa de la
// pantalla, donde hay que poder ver qué saldría sin que le llegue nada al cliente.
export async function correrRecordatoriosCobro(
  { soloSimular = false, usuario = 'cron', hoy = fechaArgentinaHoy() }: { soloSimular?: boolean; usuario?: string; hoy?: string } = {},
): Promise<ResultadoCorrida> {
  const base: ResultadoCorrida = { ok: true, enviados: 0, omitidos: [], sinEmail: [], errores: [], detalle: [] };
  try {
    await asegurarHoja(HOJA_RECORDATORIOS, HEADERS_RECORDATORIOS);
    for (const col of [COL_ACTIVO, COL_EMAIL]) await asegurarColumna('Clientes', col);

    const [clientesRaw, previos, configRows] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'),
      readSheet<RecordatorioCobro>(HOJA_RECORDATORIOS).catch(() => []),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
    ]);
    const { activos, sinEmail } = clientesConRecordatorio(clientesRaw);
    base.sinEmail = sinEmail;
    if (!activos.length) return base;

    const datosPagoFila = configRows.find((r) => String(r.clave).trim() === CONFIG_DATOS_PAGO);
    const datosPago = String(datosPagoFila?.valor || '').trim() || DATOS_PAGO_DEFAULT;

    // Una sola ventana de comprobantes sirve para las dos cosas: encontrar las facturas
    // del día objetivo y calcular el saldo de cada cliente.
    const desde = sumarDias(hoy, -DIAS_VENTANA_SALDO);
    const [comprobantes, cobranzas] = await Promise.all([
      getComprobantes(desde, hoy),
      getCobranzas(desde, hoy).catch(() => []),
    ]);
    const saldos = calcularSaldos(comprobantes, cobranzas);
    const { envios, omitidos } = calcularEnvios(hoy, activos, comprobantes, previos, saldos);
    base.omitidos = omitidos;

    let seq = previos.reduce((acc, r) => Math.max(acc, parseInt(String(r.id_recordatorio).replace(/\D/g, ''), 10) || 0), 0);
    for (const envio of envios) {
      const numeros = envio.facturas.map((f) => f.numero).join(', ');
      base.detalle.push({ cliente: envio.cliente.nombre, comprobantes: numeros, total: envio.total });
      if (soloSimular) continue;

      const r = await enviarMail({
        to: [envio.cliente.email],
        cc: COPIA_INTERNA,
        asunto: asuntoRecordatorio(envio),
        html: cuerpoRecordatorioHtml(envio, datosPago),
        texto: cuerpoRecordatorioTexto(envio, datosPago),
      });
      seq++;
      await appendRowObj(HOJA_RECORDATORIOS, {
        id_recordatorio: `RC-${String(seq).padStart(5, '0')}`,
        fecha_envio: new Date().toISOString(),
        id_control: envio.cliente.id_control,
        cliente: envio.cliente.nombre,
        comprobantes: numeros,
        importe: Math.round(envio.total),
        fecha_factura: envio.facturas[0]?.fecha || '',
        destinatarios: [envio.cliente.email, ...COPIA_INTERNA].join(', '),
        estado: r.ok ? 'enviado' : 'error',
        detalle: r.ok ? (envio.saldoCliente !== null ? `saldo del cliente: $${envio.saldoCliente.toLocaleString('es-AR')}` : '') : String(r.error || ''),
        usuario,
      });
      if (r.ok) base.enviados++;
      else base.errores.push(`${envio.cliente.nombre}: ${r.error}`);
    }
    base.ok = base.errores.length === 0;
    return base;
  } catch (e: any) {
    return { ...base, ok: false, errores: [e?.message || 'error inesperado'] };
  }
}
