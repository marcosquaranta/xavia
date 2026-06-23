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
