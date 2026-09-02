import { asegurarHoja, readSheet, appendRowObj } from './sheets';

// ── Alertas descartadas ───────────────────────────────────────────────────────────────
//
// Una alerta que no se puede sacar de la pantalla deja de ser una alerta: si siempre está
// ahí, se vuelve parte del decorado y un día la que importa pasa desapercibida.
//
// El descarte vale por MES, no para siempre. Una alerta de stock bajo describe la situación
// de un mes; el mes que viene la situación es otra y merece volver a preguntarse. Descartar
// para siempre convertiría un "ya lo sé" de hoy en un silencio permanente.

export const HOJA_DESCARTES = 'AlertasDescartadas';
export const HEADERS_DESCARTES = ['clave', 'anio', 'mes', 'usuario', 'fecha'];

export interface AlertaDescartada {
  clave: string;
  anio: number | string;
  mes: number | string;
  usuario: string;
  fecha: string;
}

// La clave lleva el mes adentro: así el descarte caduca solo al cambiar de mes.
export const claveDescarte = (clave: string, anio: number, mes: number) =>
  `${clave}__${anio}-${String(mes).padStart(2, '0')}`;

export async function leerDescartes(): Promise<Set<string>> {
  const filas = await readSheet<AlertaDescartada>(HOJA_DESCARTES).catch(() => [] as AlertaDescartada[]);
  return new Set(filas.map((f) => claveDescarte(String(f.clave), Number(f.anio), Number(f.mes))));
}

export async function descartarAlerta(clave: string, anio: number, mes: number, usuario: string): Promise<void> {
  await asegurarHoja(HOJA_DESCARTES, HEADERS_DESCARTES);
  await appendRowObj(HOJA_DESCARTES, { clave, anio, mes, usuario, fecha: new Date().toISOString() });
}

// Saca de una lista de alertas las que ya se descartaron este mes.
export function sinDescartadas<T extends { clave?: string }>(alertas: T[], descartes: Set<string>, anio: number, mes: number): T[] {
  return alertas.filter((a) => !a.clave || !descartes.has(claveDescarte(a.clave, anio, mes)));
}
