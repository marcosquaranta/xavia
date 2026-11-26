// ── Los cobros que se registraron solos, una vez por día ─────────────────────────────
//
// Antes salía un mail por cobro, en el momento. La idea era buena —si algo se registró
// mal, el momento de verlo es cuando todavía te acordás de qué aviso era— pero en la
// práctica son varios mails por día diciendo lo mismo, y varios mails por día que no piden
// nada se vuelven ruido: se archivan sin leer, y el día que uno importe también.
//
// Decisión de Marcos: uno solo, con todos los del día. El acuse de cada aviso reenviado
// sigue saliendo al instante y ya dice si el cobro quedó registrado, así que no se pierde
// la señal inmediata — lo que se saca es el segundo mail que decía lo mismo.
//
// Lo que se reporta sale de la hoja de Cobros y no de la corrida del cron: la mayoría de
// los cobros se registran cuando el aviso entra, horas antes, y una corrida del cron no
// sabe nada de esos. Se marcan con `avisado` al mandarlos, así ninguno sale dos veces ni
// se pierde si un día el cron no corre.

import { HOJA_COBROS, type CobroRegistrado } from './cobros';
import { asegurarColumnas, readSheet, updateRow } from './sheets';

export const CLAVE_AVISO_AUTO = 'email_cobro_automatico';

// Como quedó anotado el usuario de un cobro que se registró solo (ver autoCobro.ts).
const USUARIO_AUTO = 'automático';

export interface CobroAutomatico {
  idCobro: string;
  cliente: string;
  fecha: string;
  importe: number;
  retencion: number;
  comprobantes: string[];
  cuentaNombre: string;
  numeroRecibo: string;
  // Si la cuenta no salió del aviso. Se lee de la observación, que es donde autoCobro lo
  // deja escrito: es el único dato del cobro que puede no venir del aviso, y por lo tanto
  // el único que a veces hay que corregir.
  cuentaDudosa: boolean;
}

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };

export async function cobrosAutomaticosSinAvisar(
  cuentas: { id: number; nombre: string }[] = [],
): Promise<CobroAutomatico[]> {
  await asegurarColumnas(HOJA_COBROS, ['avisado']).catch(() => null);
  const filas = await readSheet<CobroRegistrado & { avisado?: string }>(HOJA_COBROS).catch(() => []);
  const nombreDe = new Map(cuentas.map((c) => [Number(c.id), c.nombre]));

  return filas
    .filter((c) => String(c.usuario || '').trim().toLowerCase() === USUARIO_AUTO)
    .filter((c) => String(c.estado || '') !== 'anulado')
    .filter((c) => String(c.avisado || '').trim().toUpperCase() !== 'SI')
    .map((c) => ({
      idCobro: String(c.id_cobro || ''),
      cliente: String(c.cliente || ''),
      fecha: String(c.fecha || '').split(/[T ]/)[0],
      importe: Math.round(num(c.importe)),
      retencion: Math.round(num(c.retencion)),
      comprobantes: String(c.comprobantes || '').split(',').map((x) => x.trim()).filter(Boolean),
      cuentaNombre: nombreDe.get(Number(c.cuenta_id)) || '',
      numeroRecibo: String(c.numero_recibo || ''),
      cuentaDudosa: /el aviso no la dec/i.test(String(c.observacion || '')),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.cliente.localeCompare(b.cliente));
}

// Se marcan DESPUÉS de que el mail salió. Al revés, un error de Resend dejaría los cobros
// marcados como avisados sin que nadie se haya enterado nunca.
export async function marcarAvisados(cobros: { idCobro: string }[]): Promise<void> {
  for (const c of cobros) {
    if (!c.idCobro) continue;
    try {
      await updateRow(HOJA_COBROS, 'id_cobro', c.idCobro, { avisado: 'SI' });
    } catch { /* que no se pueda marcar uno no puede impedir marcar el resto */ }
  }
}
