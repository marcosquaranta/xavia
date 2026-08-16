// Cliente de la API de CrossChex Cloud (https://us.crosschexcloud.com/#/system/CloudAPI)
// Un solo endpoint (API_URL) que despacha por header.nameSpace/nameAction — no es REST
// tradicional. Token cacheado a nivel de módulo (igual que el cliente de Xubio).
import { randomUUID } from 'crypto';

const API_URL = process.env.CROSSCHEX_API_URL || 'https://api.us.crosschexcloud.com/';

let cachedToken: { token: string; exp: number } | null = null;
// Pedido de token en curso (si hay uno) — ver comentario en getToken().
let tokenEnCurso: Promise<string> | null = null;

function ts(): string {
  return new Date().toISOString().replace('Z', '+00:00');
}

async function crosschexPost(nameSpace: string, nameAction: string, payload: Record<string, any>, token?: string): Promise<any> {
  const body: Record<string, any> = {
    header: { nameSpace, nameAction, version: '1.0', requestId: randomUUID(), timestamp: ts() },
    payload,
  };
  if (token) body.authorize = { type: 'token', token };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`CrossChex ${nameSpace}.${nameAction}: HTTP ${res.status}`);
  return json;
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  // Si ya hay un pedido de token en vuelo (varias llamadas a getRegistrosCrossChex
  // concurrentes dentro del mismo request, ej. Productividad pidiendo mes actual y mes
  // pasado a la vez), esperar ESE en vez de disparar uno nuevo por cada una — pedir
  // varios tokens al mismo tiempo puede hacer que CrossChex responda distinto en cada
  // uno (o rechace alguno), y eso es justamente lo que dejaba el indicador en blanco sin
  // ningún error visible (el try/catch de quien llama se lo comía silenciosamente).
  if (tokenEnCurso) return tokenEnCurso;
  tokenEnCurso = (async () => {
    try {
      const apiKey = process.env.CROSSCHEX_API_KEY;
      const apiSecret = process.env.CROSSCHEX_API_SECRET;
      if (!apiKey || !apiSecret) throw new Error('Faltan CROSSCHEX_API_KEY / CROSSCHEX_API_SECRET en el entorno');
      const json = await crosschexPost('authorize.token', 'token', { api_key: apiKey, api_secret: apiSecret });
      const token = json?.payload?.token;
      const expires = json?.payload?.expires;
      if (!token) throw new Error(json?.payload?.message || 'No se pudo obtener token de CrossChex — revisá API_KEY/API_SECRET');
      cachedToken = { token, exp: expires ? new Date(expires).getTime() : Date.now() + 3600_000 };
      return token;
    } finally {
      tokenEnCurso = null;
    }
  })();
  return tokenEnCurso;
}

export interface RegistroCrossChex {
  uuid: string;
  checktype: number;
  checktime: string; // ISO con offset
  device: { serial_number: string; name: string };
  employee: { first_name: string; last_name: string; workno: string };
}

// Trae todos los fichajes en el rango [desde, hasta] (ISO), paginando de a 100 (máximo
// que permite la API). checktype acá no distingue entrada/salida de forma confiable
// (según el equipo, es más bien el método de verificación) — el criterio para separar
// entrada/salida es: primer fichaje del día = entrada, último = salida (ver lib/personal.ts).
export async function getRegistrosCrossChex(desde: string, hasta: string): Promise<RegistroCrossChex[]> {
  let token = await getToken();
  const out: RegistroCrossChex[] = [];
  let page = 1;
  let reintentado = false;
  for (;;) {
    const json = await crosschexPost('attendance.record', 'getrecord', {
      begin_time: desde, end_time: hasta, order: 'asc', page, per_page: 100,
    }, token);
    // Antes acá solo se detectaba el token vencido comparando contra el string exacto
    // 'TOKEN_EXPIRES', y cualquier otra respuesta de error caía en `|| []` silenciosamente
    // — la quincena quedaba en 0 sin ningún aviso, como pasó en la 2da quincena de julio.
    // Ahora: si `list` no viene como array (cualquier tipo de error), se invalida el token
    // cacheado y se reintenta UNA vez con uno nuevo antes de recién ahí tirar error visible.
    const list = json?.payload?.list;
    if (!Array.isArray(list)) {
      if (!reintentado) {
        cachedToken = null;
        token = await getToken();
        reintentado = true;
        continue;
      }
      throw new Error(json?.payload?.message ? `CrossChex: ${json.payload.message}` : 'CrossChex no devolvió datos (respuesta inesperada) — probá de nuevo en unos minutos');
    }
    out.push(...list);
    const pageCount = Number(json?.payload?.pageCount) || 0;
    if (list.length < 100 || page >= pageCount) break;
    page++;
  }
  return out;
}

// Trae fichajes de varios rangos SEGUIDOS, uno por vez (nunca en paralelo). Pedirle a
// CrossChex varios rangos al mismo tiempo (ej. Productividad pidiendo 12 meses de una
// sola vez con Promise.all) puede saturar la API y dejar algunos —o todos— los pedidos
// vacíos o con error, absorbido en silencio por el try/catch de quien llama: así quedaba
// el indicador de Productividad en blanco sin ningún aviso. Usar esto en vez de
// `Promise.all(rangos.map(getRegistrosCrossChex))` en cualquier lugar que pida más de un
// rango de una.
export async function getRegistrosCrossChexSecuencial(rangos: { desde: string; hasta: string }[]): Promise<RegistroCrossChex[][]> {
  const out: RegistroCrossChex[][] = [];
  for (const r of rangos) out.push(await getRegistrosCrossChex(r.desde, r.hasta));
  return out;
}
