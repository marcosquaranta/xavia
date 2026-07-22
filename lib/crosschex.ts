// Cliente de la API de CrossChex Cloud (https://us.crosschexcloud.com/#/system/CloudAPI)
// Un solo endpoint (API_URL) que despacha por header.nameSpace/nameAction — no es REST
// tradicional. Token cacheado a nivel de módulo (igual que el cliente de Xubio).
import { randomUUID } from 'crypto';

const API_URL = process.env.CROSSCHEX_API_URL || 'https://api.us.crosschexcloud.com/';

let cachedToken: { token: string; exp: number } | null = null;

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
  const apiKey = process.env.CROSSCHEX_API_KEY;
  const apiSecret = process.env.CROSSCHEX_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('Faltan CROSSCHEX_API_KEY / CROSSCHEX_API_SECRET en el entorno');
  const json = await crosschexPost('authorize.token', 'token', { api_key: apiKey, api_secret: apiSecret });
  const token = json?.payload?.token;
  const expires = json?.payload?.expires;
  if (!token) throw new Error(json?.payload?.message || 'No se pudo obtener token de CrossChex — revisá API_KEY/API_SECRET');
  cachedToken = { token, exp: expires ? new Date(expires).getTime() : Date.now() + 3600_000 };
  return token;
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
  const token = await getToken();
  const out: RegistroCrossChex[] = [];
  let page = 1;
  for (;;) {
    const json = await crosschexPost('attendance.record', 'getrecord', {
      begin_time: desde, end_time: hasta, order: 'asc', page, per_page: 100,
    }, token);
    if (json?.payload?.message === 'TOKEN_EXPIRES') {
      cachedToken = null;
      throw new Error('El token de CrossChex expiró — reintentá');
    }
    const list: RegistroCrossChex[] = json?.payload?.list || [];
    out.push(...list);
    const pageCount = Number(json?.payload?.pageCount) || 0;
    if (list.length < 100 || page >= pageCount) break;
    page++;
  }
  return out;
}
