// ── Saber si el CAE está sacado, en vez de suponerlo ─────────────────────────────────
//
// El aviso de CAEs pendientes salía de la hoja de la app: cada factura emitida se anota
// con su `cae`, y la API de Xubio no lo devolvía al emitir, así que quedaba vacío. El
// aviso reportaba esas filas como pendientes.
//
// El problema es que el CAE se saca DESPUÉS, a mano en Xubio, y la app nunca se entera.
// La fila sigue con el `cae` vacío para siempre. Entonces el aviso no decía "falta sacar
// el CAE": decía "esta factura se emitió y nosotros no vimos el CAE", que no es lo mismo y
// se lee igual. Lo contó Marcos: le llegaron dos que ya estaban emitidas hacía días.
//
// El propio código lo tenía escrito como límite conocido ("la app no puede saber si el CAE
// se sacó"). Era una suposición, no un hecho: Xubio muestra una columna CAE en Comprobantes
// de venta. Esto va a buscarla.
//
// ── Fallar del lado seguro ──
//
// Si el campo no viene —otro nombre, otro plan, Xubio caído— todos los comprobantes se
// verían sin CAE y el aviso mandaría la misma lista falsa que antes, ahora con la
// autoridad de "lo verifiqué". Por eso, antes de afirmar nada, se mira si ALGÚN
// comprobante del período trae CAE. Si ninguno lo trae, no es que falten todos: es que el
// dato no está, y eso se dice en vez de inventar una tarea.

import { claveComprobante } from './comprobantes';

// El CAE de un comprobante de Xubio, probando las formas en que puede venir el campo.
// Un "0", un "No" o un guion son formas de decir que no hay CAE, no un CAE.
export function caeDe(bean: any): string {
  const candidatos = [bean?.cae, bean?.CAE, bean?.numeroCAE, bean?.nroCae, bean?.cai];
  for (const c of candidatos) {
    const v = String(c ?? '').trim();
    if (!v) continue;
    if (/^(0|no|-|n\/a|null|undefined)$/i.test(v)) continue;
    return v;
  }
  return '';
}

// ¿Xubio está devolviendo el CAE en este período? Si ningún comprobante lo trae, el dato
// no está disponible y no se puede afirmar que falten: ver el comentario de arriba.
export function xubioExponeCae(beans: any[]): boolean {
  return (beans || []).some((b) => caeDe(b) !== '');
}

export interface PendienteCae {
  id_emision: string;
  numero: string;
  cliente: string;
  fecha_venta: string;
}

export interface ClasificacionCae {
  // Xubio dice que YA tienen CAE: se marcan en la hoja y no se avisan nunca más.
  resueltas: { fila: PendienteCae; cae: string }[];
  // Xubio dice que NO tienen CAE y todavía se pueden sacar.
  faltan: PendienteCae[];
  // Sin CAE pero ya pasó el plazo en el que se podía hacer algo. No se avisan: la
  // numeración correlativa de AFIP no deja sacar el CAE de una factura vieja sin tocar las
  // posteriores, así que pedirlo es pedir algo que no se puede hacer.
  fueraDePlazo: PendienteCae[];
  // Emitidas por la app que Xubio no tiene en el período mirado. No es "falta el CAE": es
  // otra cosa y más grave, y se dice aparte.
  sinRastroEnXubio: PendienteCae[];
}

const soloDia = (v: any) => String(v || '').split(/[T ]/)[0];

export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`), b = Date.parse(`${hasta}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function clasificar(
  pendientes: PendienteCae[],
  comprobantes: any[],
  hoy: string,
  diasLimite: number,
): ClasificacionCae {
  const porClave = new Map<string, any>();
  for (const b of comprobantes || []) {
    const k = claveComprobante(b?.numeroDocumento ?? b?.numero);
    if (k) porClave.set(k, b);
  }

  const out: ClasificacionCae = { resueltas: [], faltan: [], fueraDePlazo: [], sinRastroEnXubio: [] };
  for (const f of pendientes || []) {
    const bean = porClave.get(claveComprobante(f.numero));
    if (!bean) { out.sinRastroEnXubio.push(f); continue; }
    const cae = caeDe(bean);
    if (cae) { out.resueltas.push({ fila: f, cae }); continue; }
    const dias = diasEntre(soloDia(f.fecha_venta), hoy);
    if (dias > diasLimite) out.fueraDePlazo.push(f);
    else out.faltan.push(f);
  }
  return out;
}
