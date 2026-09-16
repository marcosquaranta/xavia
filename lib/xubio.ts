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
export async function getCuentas(cobranzasFallback: any[] = []): Promise<{ cuentas: CuentaXubio[]; origen: string; aviso?: string }> {
  for (const path of ['cuenta?activo=true', 'cuenta']) {
    try {
      const raw = await xubioGet<any[]>(path);
      const cuentas = (Array.isArray(raw) ? raw : []).map(mapCuenta).filter((c) => c.id > 0 && c.nombre);
      if (cuentas.length) return { cuentas, origen: 'plan de cuentas de Xubio' };
    } catch { /* sigue con la próxima opción */ }
  }
  const cuentas = cuentasDeCobranzas(cobranzasFallback);
  return {
    cuentas,
    origen: 'cuentas usadas en cobranzas anteriores',
    aviso: 'Xubio no expone el plan de cuentas en este plan (GET /cuenta da 404), así que se listan las cuentas donde ya entraron cobros. Si falta alguna, hacé un cobro en esa cuenta desde Xubio una vez y aparece acá.',
  };
}

// Circuitos contables. Xubio rechaza la cobranza sin este campo ("El campo
// CircuitoContable esta vacío o es nulo"), y no tiene un default implícito: hay que
// mandarle uno de los que tiene configurados la empresa.
export interface CircuitoXubio { id: number; nombre: string }
export async function getCircuitosContables(): Promise<CircuitoXubio[]> {
  // Dos detalles que hacían que esto volviera vacío y que la cobranza se rechazara con
  // "El campo CircuitoContable esta vacío o es nulo" (verificado contra la especificación
  // de Xubio, /API/1.1/swagger.json):
  //   · el parámetro `activo` es un ENTERO (1 / 0), no un booleano: con activo=true no
  //     filtra como uno espera.
  //   · el id del bean se llama `circuitoContable_id`, con guión bajo. Se buscaba
  //     `circuitoContableId` y por eso TODOS quedaban en id 0 y los descartaba el filtro.
  // Se piden los dos: si activo=1 no trae nada, se reintenta sin filtro.
  for (const path of ['circuitoContableBean?activo=1', 'circuitoContableBean']) {
    try {
      const raw = await xubioGet<any[]>(path);
      const out = (Array.isArray(raw) ? raw : []).map((c) => ({
        id: Number(c?.circuitoContable_id ?? c?.circuitoContableId ?? c?.ID ?? c?.id ?? 0),
        nombre: String(c?.nombre || c?.codigo || ''),
      })).filter((c) => c.id > 0);
      if (out.length) return out;
    } catch { /* se prueba la variante siguiente */ }
  }
  return [];
}

// Cuál de los circuitos usar. Xubio llama "default" al circuito por defecto de la empresa;
// si está, es el que corresponde. Si no, el primero — pero es una elección arbitraria, así
// que la app devuelve el nombre usado para que se vea en pantalla qué se imputó.
export function circuitoPorDefecto(circuitos: CircuitoXubio[]): CircuitoXubio | undefined {
  return circuitos.find((c) => c.nombre.trim().toLowerCase() === 'default') || circuitos[0];
}

export interface NuevaCobranza {
  clienteId: number;
  fecha: string;        // YYYY-MM-DD
  importe: number;
  cuentaId: number;     // dónde entró la plata
  numeroRecibo?: string;
  observacion?: string;
  circuitoId?: number;
}

export async function crearCobranza(args: NuevaCobranza):
  Promise<{ ok: boolean; transaccionid?: number; numeroRecibo?: string; error?: string }> {
  const body: any = {
    cliente: { ID: args.clienteId },
    fecha: args.fecha,
    transaccionInstrumentoDeCobro: [{
      cuenta: { ID: args.cuentaId },
      importe: args.importe,
      descripcion: args.observacion || 'Cobro registrado desde XaviaApp',
    }],
  };
  if (args.numeroRecibo) body.numeroRecibo = args.numeroRecibo;
  if (args.observacion) body.observacion = args.observacion;
  if (args.circuitoId) body.circuitoContable = { ID: args.circuitoId };

  const res = await xubioPost<any>('cobranzaBean', body);
  if (!res.ok) {
    const err = res.data?.description || res.data?.error || res.data?.message || `HTTP ${res.status}`;
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

async function xubioPost<T = any>(path: string, body: any): Promise<{ ok: boolean; status: number; data: T }> {
  const token = await getToken();
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({} as any));
  return { ok: res.ok, status: res.status, data };
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
