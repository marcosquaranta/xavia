// ── Cuándo se revisó por última vez la cuenta de cada cliente ────────────────────────
//
// Marcar "revisado" no es lo mismo que marcar facturas como saldadas, y es importante que
// no se mezclen: saldar dice "esta factura está paga"; revisar dice "miré esta cuenta y a
// esta fecha estaba bien". Lo primero cambia lo que se reclama, lo segundo no cambia nada —
// es memoria de control.
//
// Se guarda además una FOTO de lo que había en ese momento: cuántas facturas abiertas y por
// cuánto. Sin eso, el sello solo dice cuándo alguien afirmó que estaba bien, y no hay forma
// de verificarlo ni de saber qué pasó después. Con la foto, la app puede decir "revisado
// hace 12 días, en ese momento debía $400.000 en 6 facturas; hoy debe $650.000 en 9", que
// es lo que de verdad se quiere saber al volver.

import { appendRowObj, asegurarHoja, readSheet } from './sheets';
import { fechaArgentinaHoy } from './ocupacion';

export const HOJA_REVISIONES = 'RevisionesCliente';
export const HEADERS_REVISIONES = [
  'id_revision', 'id_control', 'cliente', 'fecha', 'usuario',
  'facturas_abiertas', 'monto_abierto', 'notas',
];

export interface RevisionCliente {
  id_revision: string;
  id_control: string;
  cliente: string;
  fecha: string;            // YYYY-MM-DD
  usuario: string;
  facturas_abiertas: number | string;
  monto_abierto: number | string;
  notas: string;
}

// Cuántos días pasados los cuales una cuenta se considera sin controlar. No es una regla
// contable: es el plazo en el que un error de imputación todavía se puede rastrear contra
// el extracto del banco sin que sea una arqueología.
export const DIAS_REVISION_VIEJA = 30;

export async function leerRevisiones(): Promise<RevisionCliente[]> {
  return readSheet<RevisionCliente>(HOJA_REVISIONES).catch(() => []);
}

// La última revisión de cada cliente. Se guarda el historial completo —las anteriores no se
// pisan— porque "cada cuánto se controla este cliente" es justamente lo que se quiere poder
// mirar después, y eso no se puede reconstruir si solo queda la última.
export function ultimaRevisionPorCliente(revisiones: RevisionCliente[]): Record<string, RevisionCliente> {
  const out: Record<string, RevisionCliente> = {};
  for (const r of revisiones || []) {
    const id = String(r?.id_control || '').trim();
    const f = String(r?.fecha || '').slice(0, 10);
    if (!id || !f) continue;
    const prev = out[id];
    if (!prev || f >= String(prev.fecha).slice(0, 10)) out[id] = r;
  }
  return out;
}

export function diasDesde(fecha: string, hoy = fechaArgentinaHoy()): number {
  const a = new Date(String(fecha).slice(0, 10) + 'T12:00:00').getTime();
  const b = new Date(hoy + 'T12:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export interface PedidoRevision {
  id_control: string;
  cliente: string;
  usuario: string;
  facturasAbiertas: number;
  montoAbierto: number;
  notas?: string;
}

export async function registrarRevision(p: PedidoRevision): Promise<RevisionCliente> {
  await asegurarHoja(HOJA_REVISIONES, HEADERS_REVISIONES);
  const previas = await leerRevisiones();
  const seq = previas.reduce(
    (a, r) => Math.max(a, parseInt(String(r.id_revision).replace(/\D/g, ''), 10) || 0), 0,
  ) + 1;
  const fila: RevisionCliente = {
    id_revision: `REV-${String(seq).padStart(5, '0')}`,
    id_control: String(p.id_control),
    cliente: String(p.cliente || ''),
    fecha: fechaArgentinaHoy(),
    usuario: p.usuario,
    facturas_abiertas: Math.max(0, Math.round(p.facturasAbiertas)),
    monto_abierto: Math.round(p.montoAbierto),
    notas: String(p.notas || '').slice(0, 300),
  };
  await appendRowObj(HOJA_REVISIONES, fila as any);
  return fila;
}

// Qué cambió desde la última revisión. Null cuando nunca se revisó: no hay con qué comparar,
// y mostrar "+9 facturas" contra una base que no existe sería inventar un dato.
export interface CambioDesdeRevision {
  dias: number;
  facturasAntes: number;
  montoAntes: number;
  facturasAhora: number;
  montoAhora: number;
  facturasNuevas: number;
  montoNuevo: number;
}

export function cambioDesdeRevision(
  revision: RevisionCliente | undefined,
  facturasAhora: number,
  montoAhora: number,
  hoy = fechaArgentinaHoy(),
): CambioDesdeRevision | null {
  if (!revision) return null;
  const facturasAntes = Number(revision.facturas_abiertas) || 0;
  const montoAntes = Number(revision.monto_abierto) || 0;
  return {
    dias: diasDesde(String(revision.fecha), hoy),
    facturasAntes, montoAntes,
    facturasAhora, montoAhora,
    facturasNuevas: facturasAhora - facturasAntes,
    montoNuevo: Math.round(montoAhora - montoAntes),
  };
}
