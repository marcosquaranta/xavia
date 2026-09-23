// Cliente de la API de Xubio (https://xubio.com/API/1.1/)
// OAuth2 client-credentials. Token válido 1h, cacheado a nivel de módulo.

const TOKEN_URL = 'https://xubio.com/API/1.1/TokenEndpoint';
const BASE = 'https://xubio.com/API/1.1';

// Punto de venta → letra de comprobante (según config del usuario)
export const PV_FISCAL = '00002';   // Factura A, electrónica con CAE
export const PV_NO_FISCAL = '00001'; // Factura B, sin CAE (no se informa)

let cachedToken: { token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const id = process.env.XUBIO_CLIENT_ID;
  const secret = process.env.XUBIO_SECRET;
  if (!id || !secret) throw new Error('Faltan credenciales XUBIO_CLIENT_ID / XUBIO_SECRET en el entorno');
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Xubio: error obteniendo token (HTTP ${res.status})`);
  const j: any = await res.json();
  const expiresIn = Number(j.expires_in) || 3600;
  cachedToken = { token: j.access_token, exp: Date.now() + expiresIn * 1000 };
  return cachedToken.token;
}

export async function xubioGet<T = any>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}/${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Xubio GET ${path} → HTTP ${res.status}`);
  return res.json();
}

const fmtDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Trae comprobantes en un rango de fechas. Si la respuesta llega al tope de 100
// (posible truncamiento), parte el rango a la mitad y junta — así no se pierde nada.
async function comprobantesEnRango(desde: string, hasta: string): Promise<any[]> {
  const comps = await xubioGet<any[]>(`comprobanteVentaBean?fechaDesde=${desde}&fechaHasta=${hasta}`);
  if (!Array.isArray(comps) || comps.length < 100) return comps || [];
  const d1 = new Date(desde + 'T12:00:00');
  const d2 = new Date(hasta + 'T12:00:00');
  if (d1 >= d2) return comps; // no se puede subdividir más
  const mid = new Date((d1.getTime() + d2.getTime()) / 2);
  const midStr = fmtDia(mid);
  const nextStr = fmtDia(new Date(mid.getTime() + 86_400_000));
  const [a, b] = await Promise.all([comprobantesEnRango(desde, midStr), comprobantesEnRango(nextStr, hasta)]);
  const map = new Map<number, any>();
  for (const c of [...a, ...b]) map.set(c.transaccionid, c);
  return [...map.values()];
}

// Comprobantes de venta de un rango (con importe y cliente) — para los recordatorios de
// cobro. Se expone el wrapper y no comprobantesEnRango directo para no perder el manejo de
// truncamiento a 100 resultados que hace esa función.
export async function getComprobantes(desde: string, hasta: string): Promise<any[]> {
  return comprobantesEnRango(desde, hasta);
}

// Cobranzas (recibos) de un rango. Xubio NO permite saber si una factura puntual está
// paga: comprobanteVentaBean no tiene saldo/estado/pagado, y las cobranzas no traen a qué
// comprobante se imputan (verificado contra la especificación OpenAPI, sept-2026). Lo que
// sí se puede es sumar lo cobrado por cliente y compararlo con lo facturado: alcanza para
// NO mandarle un recordatorio a alguien que está al día, que es el error caro acá.
export async function getCobranzas(desde: string, hasta: string): Promise<any[]> {
  const cobs = await xubioGet<any[]>(`cobranzaBean?fechaDesde=${desde}&fechaHasta=${hasta}`);
  return Array.isArray(cobs) ? cobs : [];
}

// Importe de una cobranza = suma de sus instrumentos de cobro (efectivo, cheque, banco).
export function importeCobranza(cob: any): number {
  const items = cob?.transaccionInstrumentoDeCobro;
  if (!Array.isArray(items)) return 0;
  return items.reduce((a: number, i: any) => a + (Number(i?.importe) || 0), 0);
}

// ── Cobranzas: registrar un cobro en Xubio desde la app ──────────────────────────────
//
// Xubio SÍ deja crear cobranzas por API (POST /cobranzaBean) y borrarlas
// (DELETE /cobranzaBean/{id}) — o sea que un error es reversible, que es lo que hace
// razonable operar esto desde acá.
//
// LO QUE NO SE PUEDE, y hay que tener claro: la cobranza NO se imputa a facturas
// puntuales. El bean no tiene dónde decir "esto cancela la factura A-00002-00000101";
// entra a la cuenta corriente del cliente como un cobro a cuenta. Para el objetivo de
// Marcos (dejar de deberle plata en la cuenta corriente y que impacte en Xubio) alcanza;
// si alguna vez hace falta imputar comprobante por comprobante, eso sigue siendo a mano.

export interface CuentaXubio { id: number; nombre: string; codigo: string }

function mapCuenta(c: any): CuentaXubio {
  return {
    id: Number(c?.cuentaId ?? c?.ID ?? c?.id ?? 0),
    nombre: String(c?.nombre || ''),
    codigo: String(c?.codigo || ''),
  };
}

// Cuentas que ya se usaron para cobrar, sacadas de las cobranzas existentes. Es el camino
// que de verdad funciona en esta cuenta de Xubio (ver getCuentas) y además devuelve algo
// mejor que el plan de cuentas entero: solo las cuentas donde realmente entra la plata,
// ordenadas por uso.
export function cuentasDeCobranzas(cobranzas: any[]): CuentaXubio[] {
  const uso = new Map<number, { cuenta: CuentaXubio; n: number }>();
  for (const cob of cobranzas) {
    for (const inst of (cob?.transaccionInstrumentoDeCobro || [])) {
      const c = mapCuenta(inst?.cuenta);
      if (!(c.id > 0) || !c.nombre) continue;
      const prev = uso.get(c.id);
      if (prev) prev.n++;
      else uso.set(c.id, { cuenta: c, n: 1 });
    }
  }
  return [...uso.values()].sort((a, b) => b.n - a.n).map((u) => u.cuenta);
}

// Cuentas donde puede entrar la plata.
//
// OJO: /cuenta está documentado en la especificación de Xubio pero devuelve 404 en esta
// cuenta (verificado en producción, sept-2026) — probablemente no esté habilitado en este
// plan. Por eso se intenta y, si no está, se caen las cuentas desde las cobranzas ya
// cargadas. Se devuelve `origen` para poder decir en pantalla de dónde salieron, en vez de
// mostrar una lista sin explicar por qué es corta.
// Las formas de pedir el plan de cuentas, en orden. `activo=1` está primero porque el
// parámetro es un ENTERO y no un booleano: con `activo=true` Xubio contesta 404, que es
// exactamente el mismo error que tenía el listado de circuitos contables y que hizo creer
// durante semanas que el endpoint no estaba habilitado en este plan.
const PATHS_CUENTAS = ['cuenta?activo=1', 'cuenta', 'cuenta?activo=0', 'banco'];

export async function getCuentas(cobranzasFallback: any[] = []): Promise<{ cuentas: CuentaXubio[]; origen: string; aviso?: string }> {
  for (const path of PATHS_CUENTAS) {
    try {
      const raw = await xubioGet<any[]>(path);
      const cuentas = (Array.isArray(raw) ? raw : []).map(mapCuenta).filter((c) => c.id > 0 && c.nombre);
      if (cuentas.length) return { cuentas, origen: `plan de cuentas de Xubio (${path})` };
    } catch (e: any) {
      console.error(`[xubio] ${path} falló:`, e?.message || e);
    }
  }
  const cuentas = cuentasDeCobranzas(cobranzasFallback);
  return {
    cuentas,
    origen: 'cuentas usadas en cobranzas anteriores',
    aviso: 'Xubio no devolvió el plan de cuentas, así que se listan solo las cuentas donde YA entró algún cobro. Por eso puede faltar alguna: hacé un cobro en esa cuenta desde Xubio una vez y a partir de ahí aparece acá.',
  };
}

// Qué contesta Xubio a cada forma de pedir el plan de cuentas. Sin esto, "solo aparece
// Brubank" no se puede distinguir de "el endpoint no responde": son problemas distintos.
export async function diagnosticoCuentas(): Promise<string> {
  const partes: string[] = [];
  for (const path of PATHS_CUENTAS) {
    try {
      const raw = await xubioGet<any>(path);
      if (Array.isArray(raw)) {
        partes.push(`${path}: ${raw.length} filas${raw.length ? ` · ej: ${JSON.stringify(raw[0]).slice(0, 120)}` : ''}`);
      } else {
        partes.push(`${path}: respondió ${typeof raw} (no una lista)`);
      }
    } catch (e: any) {
      partes.push(`${path}: ${e?.message || 'error'}`);
    }
  }
  return partes.join(' · ');
}

// Circuitos contables. Xubio rechaza la cobranza sin este campo ("El campo
// CircuitoContable esta vacío o es nulo"), y no tiene un default implícito: hay que
// mandarle uno de los que tiene configurados la empresa.
// El id se guarda COMO VIENE, sin convertirlo a número.
//
// Xubio devolvía los dos circuitos de la empresa con la clave correcta y la app los
// descartaba igual, porque el filtro exigía `Number(id) > 0` y ese identificador no es
// numérico. Un id es una etiqueta que hay que devolver idéntica a como llegó: interpretarlo
// solo agrega formas de perderlo.
export interface CircuitoXubio { id: string | number; nombre: string; origen?: string }

function mapCircuito(c: any): CircuitoXubio {
  // El bean lo llama `circuitoContable_id`, con guión bajo (especificación de Xubio,
  // /API/1.1/swagger.json). Las otras formas están por si cambia.
  const crudo = c?.circuitoContable_id ?? c?.circuitoContableId ?? c?.ID ?? c?.id;
  const id = crudo === null || crudo === undefined ? '' : (typeof crudo === 'object' ? '' : crudo);
  return { id, nombre: String(c?.nombre || c?.codigo || '') };
}

// Un id sirve si tiene contenido. El cero explícito no: es lo que devuelve Xubio cuando el
// campo está vacío.
function idUsable(id: string | number): boolean {
  if (typeof id === 'number') return Number.isFinite(id) && id !== 0;
  return String(id ?? '').trim() !== '' && String(id).trim() !== '0';
}

// El circuito que usan las cobranzas YA CARGADAS. Es el camino que no puede fallar: si la
// empresa cargó cobranzas alguna vez, el circuito que usó está ahí adentro. El listado
// dedicado depende de que ese endpoint esté habilitado en el plan —lo mismo que pasó con
// el plan de cuentas, que devuelve 404— y sin este respaldo un endpoint que no responde
// deja la app sin poder registrar un solo cobro.
export function circuitosDeCobranzas(cobranzas: any[]): CircuitoXubio[] {
  const uso = new Map<string | number, { c: CircuitoXubio; n: number }>();
  for (const cob of cobranzas || []) {
    const c = mapCircuito(cob?.circuitoContable);
    if (!idUsable(c.id)) continue;
    const prev = uso.get(c.id);
    if (prev) prev.n++;
    else uso.set(c.id, { c: { ...c, nombre: c.nombre || `Circuito ${c.id}`, origen: 'cobranzas anteriores' }, n: 1 });
  }
  return [...uso.values()].sort((a, b) => b.n - a.n).map(u => u.c);
}

// Con `cobranzasFallback` se puede resolver el circuito aunque el listado no responda.
export async function getCircuitosContables(cobranzasFallback: any[] = []): Promise<CircuitoXubio[]> {
  // El parámetro `activo` es un ENTERO (1 / 0), no un booleano: con activo=true no filtra
  // como uno espera. Se prueban las dos variantes.
  for (const path of ['circuitoContableBean?activo=1', 'circuitoContableBean']) {
    try {
      const raw = await xubioGet<any[]>(path);
      const out = (Array.isArray(raw) ? raw : []).map(mapCircuito).filter((c) => idUsable(c.id));
      if (out.length) return out.map(c => ({ ...c, origen: 'listado de Xubio' }));
    } catch (e: any) {
      console.error(`[xubio] ${path} falló:`, e?.message || e);
    }
  }
  return circuitosDeCobranzas(cobranzasFallback);
}

// Qué contestó Xubio cuando se le pidieron los circuitos. Sirve para que el mensaje de
// error diga algo accionable en vez de "no devolvió ninguno": la diferencia entre que el
// endpoint no exista, que conteste vacío o que conteste objetos con otra forma cambia por
// completo qué hay que hacer.
export async function diagnosticoCircuitos(): Promise<string> {
  const partes: string[] = [];
  for (const path of ['circuitoContableBean?activo=1', 'circuitoContableBean']) {
    try {
      const raw = await xubioGet<any>(path);
      if (Array.isArray(raw)) {
        // Con las claves solas no alcanzó para entender por qué se descartaban: hacen falta
        // los valores. Son el id y el nombre de un circuito contable, nada sensible.
        const muestra = raw.length ? ` · primera fila: ${JSON.stringify(raw[0]).slice(0, 200)}` : '';
        partes.push(`${path}: ${raw.length} filas${muestra}`);
      } else {
        partes.push(`${path}: respondió ${typeof raw} (no una lista)`);
      }
    } catch (e: any) {
      partes.push(`${path}: ${e?.message || 'error'}`);
    }
  }
  return partes.join(' · ');
}

// Cuál de los circuitos usar. Xubio llama "default" al circuito por defecto de la empresa;
// si está, es el que corresponde. Si no, el primero — pero es una elección arbitraria, así
// que la app devuelve el nombre usado para que se vea en pantalla qué se imputó.
export function circuitoPorDefecto(circuitos: CircuitoXubio[]): CircuitoXubio | undefined {
  return circuitos.find((c) => c.nombre.trim().toLowerCase() === 'default') || circuitos[0];
}

// ── Moneda de la cuenta corriente ───────────────────────────────────────────────────
//
// Xubio también exige este campo ("El campo MonedaCtaCte esta vacío o es nulo") y tampoco
// asume uno por defecto, aunque la empresa opere solo en pesos.
//
// Igual que con el circuito y con las cuentas: en vez de inventar el id de "Pesos
// Argentinos" —que varía entre cuentas de Xubio— se copia el que usan las cobranzas ya
// cargadas. Es el dato correcto por definición: es el que la empresa viene usando.
// El objeto entero como vino de Xubio. Reconstruirlo con solo el ID fue lo que rompió:
// la lección del circuito contable vale igual acá — lo que Xubio devolvió, se le devuelve
// idéntico, porque no hay forma de saber qué campos necesita de vuelta.
export type MonedaXubio = Record<string, any>;

export interface DatosMoneda {
  moneda: MonedaXubio | null;
  cotizacion: number;
  utilizaMonedaExtranjera: number;
}

// Los tres campos de moneda salen juntos de las cobranzas ya cargadas, y de la MISMA
// cobranza. Xubio los pide de a uno —primero MonedaCtaCte, después UtilizaMonedaExtranjera—
// y no tienen sentido por separado: una cotización sin su moneda, o una bandera de moneda
// extranjera que no corresponde a la moneda que se manda, es una combinación que la empresa
// nunca usó. Copiando la terna completa de un recibo real no hay forma de inventar una
// combinación inválida.
export function datosMonedaDeCobranzas(cobranzas: any[]): DatosMoneda {
  const conMoneda = (cobranzas || []).filter((c) => {
    const m = c?.monedaCtaCte;
    if (!m || typeof m !== 'object') return false;
    const id = m.ID ?? m.id ?? m.moneda_id;
    return id !== null && id !== undefined && String(id).trim() !== '';
  });

  // La combinación más usada, no la primera: una cobranza suelta en dólares no puede
  // definir cómo se carga el resto.
  const uso = new Map<string, { d: DatosMoneda; n: number }>();
  for (const c of conMoneda) {
    const m = c.monedaCtaCte;
    const id = String(m.ID ?? m.id ?? m.moneda_id);
    const prev = uso.get(id);
    if (prev) { prev.n++; continue; }
    const cot = Number(c?.cotizacion);
    const ume = Number(c?.utilizaMonedaExtranjera);
    uso.set(id, {
      n: 1,
      d: {
        moneda: { ...m },
        cotizacion: Number.isFinite(cot) && cot > 0 ? cot : 1,
        // 0 = moneda local. Es el valor de una empresa que factura en pesos, y es el que
        // corresponde cuando la cobranza anterior no lo trae.
        utilizaMonedaExtranjera: Number.isFinite(ume) ? ume : 0,
      },
    });
  }

  const orden = [...uso.values()].sort((a, b) => b.n - a.n);
  if (orden.length) return orden[0].d;
  return { moneda: null, cotizacion: 1, utilizaMonedaExtranjera: 0 };
}

// El renglón de "dónde entró la plata", copiado de una cobranza real.
//
// Armarlo a mano con cuenta + importe + descripción hacía que Xubio contestara un 500 con
// una página de error de Tomcat: su servidor se rompe, no valida. Un 500 sin mensaje no se
// puede diagnosticar desde afuera, así que en vez de adivinar qué campo falta se copia la
// estructura de un recibo que Xubio aceptó —con cuentaTipo, moneda, cotización y lo que
// sea que lleve— y se reemplaza solo lo que cambia.
//
// Los identificadores del recibo viejo se borran a propósito: dejarlos pegaría el cobro
// nuevo a una transacción que ya existe.
const CLAVES_A_BORRAR = ['transaccionICId', 'transaccionId', 'transaccionid', 'itemId'];

export function plantillaInstrumento(cobranzas: any[], cuentaId: number): Record<string, any> | null {
  const instrumentos: any[] = [];
  for (const cob of cobranzas || []) {
    for (const inst of (cob?.transaccionInstrumentoDeCobro || [])) {
      if (inst && typeof inst === 'object') instrumentos.push(inst);
    }
  }
  if (!instrumentos.length) return null;

  // Se prefiere un renglón de la MISMA cuenta: cada cuenta puede tener su tipo, y el de la
  // cuenta correcta es el que seguro funciona para esa cuenta.
  const mismaCuenta = instrumentos.find((i) => {
    const id = i?.cuenta?.ID ?? i?.cuenta?.id ?? i?.cuenta?.cuentaId;
    return String(id) === String(cuentaId);
  });

  const base = { ...(mismaCuenta || instrumentos[0]) };
  for (const k of CLAVES_A_BORRAR) delete base[k];
  return base;
}

export interface NuevaCobranza {
  clienteId: number;
  fecha: string;        // YYYY-MM-DD
  importe: number;
  cuentaId: number;     // dónde entró la plata
  numeroRecibo?: string;
  observacion?: string;
  circuitoId?: string | number;
  moneda?: MonedaXubio | null;
  cotizacion?: number;
  utilizaMonedaExtranjera?: number;
  // Renglón de una cobranza anterior del que copiar la estructura (ver plantillaInstrumento).
  plantilla?: Record<string, any> | null;
}

export async function crearCobranza(args: NuevaCobranza):
  Promise<{ ok: boolean; transaccionid?: number; numeroRecibo?: string; error?: string }> {
  const body: any = {
    cliente: { ID: args.clienteId },
    fecha: args.fecha,
    transaccionInstrumentoDeCobro: [{
      // Sobre la plantilla del recibo real: así viajan los campos que Xubio necesita y que
      // no están documentados. Sin plantilla se manda lo mínimo, que es como estaba antes.
      ...(args.plantilla || {}),
      cuenta: { ID: args.cuentaId },
      importe: args.importe,
      descripcion: args.observacion || 'Cobro registrado desde XaviaApp',
    }],
  };
  if (args.numeroRecibo) body.numeroRecibo = args.numeroRecibo;
  if (args.observacion) body.observacion = args.observacion;
  if (args.circuitoId) body.circuitoContable = { ID: args.circuitoId };
  if (args.moneda) {
    body.monedaCtaCte = args.moneda;
    body.cotizacion = args.cotizacion && args.cotizacion > 0 ? args.cotizacion : 1;
    // Va SIEMPRE que haya moneda, incluso en cero: Xubio lo rechaza por vacío o nulo, y
    // cero es un valor, no una ausencia.
    body.utilizaMonedaExtranjera = Number.isFinite(args.utilizaMonedaExtranjera as number)
      ? args.utilizaMonedaExtranjera
      : 0;
  }

  const res = await xubioPost<any>('cobranzaBean', body);
  if (!res.ok) {
    const conocido = res.data?.description || res.data?.error || res.data?.message;
    // Cuando Xubio no manda un mensaje reconocible va el cuerpo crudo recortado: sin eso
    // un 500 no se puede diagnosticar desde acá, porque no hay acceso a sus logs.
    // De una página de error de Tomcat lo único que sirve son las líneas de "Message" y
    // "Description"; el resto es el CSS de la plantilla. Si no están, queda claro que el
    // servidor se rompió sin decir por qué, que también es información.
    const limpio = String(res.crudo || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const err = conocido || `HTTP ${res.status}${limpio ? ` — contestó: ${limpio.slice(0, 400)}` : ''}`;
    console.error('[xubio] cobranzaBean rechazada:', res.status, res.crudo?.slice(0, 500));
    console.error('[xubio] cuerpo enviado:', JSON.stringify(body).slice(0, 800));
    return { ok: false, error: String(err) };
  }
  return { ok: true, transaccionid: res.data?.transaccionid, numeroRecibo: res.data?.numeroRecibo };
}

// Para deshacer una cobranza cargada por error. Solo se usa sobre las que registró la app
// (la app guarda el transaccionid), nunca sobre una cargada a mano en Xubio.
export async function borrarCobranza(transaccionid: number): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken();
  const res = await fetch(`${BASE}/cobranzaBean/${transaccionid}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return { ok: true };
}

// Fecha del ÚLTIMO comprobante emitido en cada letra (A / B).
//
// Hace falta porque la numeración de un punto de venta es correlativa y AFIP no permite que
// un comprobante con número mayor tenga fecha anterior a uno ya emitido. Si quedaron ventas
// viejas sin facturar y en el medio se emitió algo con fecha de hoy, facturar esas ventas
// con su fecha original hace que Xubio rechace la factura entera:
//   "El documento número A-00002-00000849 tiene fecha mayor a la fecha del documento que
//    desea emitir".
export async function ultimaFechaPorLetra(dias = 30): Promise<Record<string, string>> {
  const hoy = new Date();
  const desde = fmtDia(new Date(hoy.getTime() - dias * 86_400_000));
  const comps = await comprobantesEnRango(desde, fmtDia(hoy));
  const out: Record<string, string> = {};
  for (const c of comps || []) {
    const letra = String(c?.numeroDocumento || '').match(/^([A-Z])-/)?.[1];
    if (!letra) continue;
    const f = String(c?.fecha || '').split(/[T ]/)[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) continue;
    if (!out[letra] || f > out[letra]) out[letra] = f;
  }
  return out;
}

export interface UltimoNumeroPV { pv: string; letra: string; numeroCompleto: string; numero: number; }

// Último número emitido por punto de venta (a partir de los comprobantes recientes)
export async function getUltimosNumerosPorPV(): Promise<UltimoNumeroPV[]> {
  const comps = await xubioGet<any[]>('comprobanteVentaBean');
  const porPV = new Map<string, string>(); // "A-00002" → numeroDocumento máximo
  for (const c of comps || []) {
    const nd = String(c.numeroDocumento || '');
    const m = nd.match(/^([A-Z])-(\d{4,5})-(\d+)$/);
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    const prev = porPV.get(key);
    if (!prev || nd > prev) porPV.set(key, nd);
  }
  return [...porPV.values()].map(nd => {
    const m = nd.match(/^([A-Z])-(\d{4,5})-(\d+)$/)!;
    return { pv: m[2], letra: m[1], numeroCompleto: nd, numero: Number(m[3]) };
  }).sort((a, b) => a.pv.localeCompare(b.pv));
}

// ─────────────────────────────────────────────────────────────
// Emisión de facturas (recurso /facturar)
// ─────────────────────────────────────────────────────────────

export const PV_ID_A = 126160; // PV 00002 — Factura A, electrónica con CAE
export const PV_ID_B = 123457; // PV 00001 — Factura B, sin CAE

// Mapeo de nuestros productos al NOMBRE de producto en Xubio (no hay un código aparte
// cargado en el catálogo — la conexión con Xubio siempre fue por nombre de producto,
// igual que con el cliente en matchClienteXubio más abajo).
export const PRODUCTO_CODIGO: Record<string, string> = {
  rucula: 'RUCULA_HIDROPONICA',
  lechuga_crespa: 'LECHUGA_CRESPA_HIDROPONICA',
  hoja_roble: 'LECHUGA_HOJA_DE_ROBLE_VERDE_HIDROPONICA',
  bandeja_rucula: 'BANDEJA_RUCULA_HIDROPONICA',
  albahaca: 'ALBAHACA_HIDROPONICA',
  rucula_kg: 'RUCULA_HIDROPONICA_KG',
  lechuga_kg: 'LECHUGA_HIDROPONICA_KG', // legacy, ventas cargadas antes del split crespa/roble
  // Nombres reales confirmados por el usuario, tal cual figuran en Xubio.
  lechuga_kg_crespa: 'KG Lechuga Crespa',
  lechuga_kg_roble: 'KG Lechuga Hoja de Roble',
};

async function xubioPost<T = any>(path: string, body: any): Promise<{ ok: boolean; status: number; data: T; crudo: string }> {
  const token = await getToken();
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  // Se lee como TEXTO y después se intenta parsear. Con `res.json().catch(() => ({}))` un
  // error 500 —que Xubio contesta en HTML o en texto plano— se convertía en un objeto
  // vacío, y el mensaje que llegaba a la pantalla era "HTTP 500" a secas: sin una palabra
  // sobre qué campo estaba mal.
  const crudo = await res.text().catch(() => '');
  let data: any = {};
  try { data = crudo ? JSON.parse(crudo) : {}; } catch { /* no era JSON: queda el texto */ }
  return { ok: res.ok, status: res.status, data, crudo };
}

export interface ClienteXubio { cliente_id: number; nombre: string; }
export async function getClientesXubio(): Promise<ClienteXubio[]> {
  return xubioGet<ClienteXubio[]>('clienteBean');
}

const normNombre = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// Busca el cliente en Xubio por nombre (normalizado, sin acentos/mayúsculas)
export function matchClienteXubio(nombreLocal: string, clientes: ClienteXubio[]): number | null {
  const target = normNombre(nombreLocal);
  const found = clientes.find(c => normNombre(c.nombre) === target);
  return found ? found.cliente_id : null;
}

export interface FacturaItem { codigo: string; cantidad: number; precio: number; descripcion?: string; }

// Emite una factura en Xubio. Para PV electrónico (A) Xubio saca el CAE en el momento.
export async function emitirFactura(args: { clienteId: number; esA: boolean; fecha: string; items: FacturaItem[] }):
  Promise<{ ok: boolean; numeroDocumento?: string; cae?: string; transaccionid?: number; error?: string }> {
  const fechaVto = (() => { const d = new Date(args.fecha + 'T12:00:00'); d.setDate(d.getDate() + 5); return fmtDia(d); })();
  const body = {
    tipo: 1,
    cliente: { ID: args.clienteId },
    fecha: args.fecha,
    fechaVto,
    puntoVenta: { ID: args.esA ? PV_ID_A : PV_ID_B },
    condicionDePago: 1,
    deposito: { codigo: 'DEPOSITO_UNIVERSAL' },
    transaccionProductoItems: args.items.map(it => ({
      // Conexión con el producto por NOMBRE, no por código (mismo criterio que el
      // cliente en matchClienteXubio) — Xubio no tiene un código propio cargado para
      // estos productos.
      producto: { nombre: it.codigo },
      descripcion: it.descripcion || '',
      cantidad: it.cantidad,
      precio: it.precio,
      precioconivaincluido: it.precio,
      montoExento: 0,
      porcentajeDescuento: 0,
    })),
  };
  const res = await xubioPost<any>('facturar', body);
  if (!res.ok) {
    const err = res.data?.description || res.data?.error || `HTTP ${res.status}`;
    return { ok: false, error: String(err) };
  }
  return { ok: true, numeroDocumento: res.data?.numeroDocumento, cae: res.data?.cae || res.data?.CAE, transaccionid: res.data?.transaccionid };
}

export interface VentaMes { mes: string; total: number; cantidad: number; }

// Ventas (facturadas en Xubio) por mes en $, últimos N meses
export async function getVentasMensuales(meses = 6): Promise<VentaMes[]> {
  const hoy = new Date();
  const out: VentaMes[] = [];
  const rangos = Array.from({ length: meses }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const y = d.getFullYear(), mo = d.getMonth();
    const ultimoDia = new Date(y, mo + 1, 0).getDate();
    return {
      mes: `${y}-${String(mo + 1).padStart(2, '0')}`,
      desde: `${y}-${String(mo + 1).padStart(2, '0')}-01`,
      hasta: `${y}-${String(mo + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`,
    };
  });
  const resultados = await Promise.all(rangos.map(async r => {
    const comps = await comprobantesEnRango(r.desde, r.hasta);
    const total = comps.reduce((a, c) => a + (Number(c.importetotal) || 0), 0);
    return { mes: r.mes, total, cantidad: comps.length };
  }));
  out.push(...resultados);
  return out;
}
