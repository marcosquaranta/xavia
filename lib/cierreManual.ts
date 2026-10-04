// ── Los pasos del cierre que se marcan a mano ────────────────────────────────────────
//
// Hay pasos que la app puede verificar sola —si el stock está cargado, si los saldos
// cuadran— y otros que no: bajar el resumen del banco, comparar contra el Excel, dar el mes
// por cerrado. Esos últimos venían como recordatorio en gris, sin forma de tildarlos, así
// que cada vez que se volvía a la pantalla había que acordarse de cuáles ya estaban hechos.
//
// Se guarda por mes y por paso. Y se guarda el id del paso, no su posición: si mañana se
// agrega un paso en el medio, un marcado guardado como "paso 4" pasaría a tildar otra cosa.

import { appendRowObj, asegurarHoja, readSheet, updateRow } from './sheets';

export const HOJA_CIERRE = 'CierreChecklist';
export const HEADERS_CIERRE = ['clave', 'anio', 'mes', 'paso', 'hecho', 'usuario', 'fecha'];

export interface PasoManual {
  clave: string;   // anio-mes-paso
  anio: number | string;
  mes: number | string;
  paso: string;
  hecho: string;   // 'SI' o vacío
  usuario: string;
  fecha: string;
}

const clave = (anio: number, mes: number, paso: string) => `${anio}-${mes}-${paso}`;

export async function leerPasosManuales(): Promise<PasoManual[]> {
  return readSheet<PasoManual>(HOJA_CIERRE).catch(() => []);
}

// Los pasos marcados de un mes, como set de ids.
export function marcadosDelMes(filas: PasoManual[], anio: number, mes: number): Set<string> {
  const out = new Set<string>();
  for (const f of filas || []) {
    if (String(f?.hecho || '').toUpperCase() !== 'SI') continue;
    if (String(f?.anio) !== String(anio) || String(f?.mes) !== String(mes)) continue;
    const p = String(f?.paso || '').trim();
    if (p) out.add(p);
  }
  return out;
}

export async function marcarPaso(args: {
  anio: number; mes: number; paso: string; hecho: boolean; usuario: string;
}): Promise<void> {
  await asegurarHoja(HOJA_CIERRE, HEADERS_CIERRE);
  const k = clave(args.anio, args.mes, args.paso);
  const previas = await leerPasosManuales();
  const campos = {
    hecho: args.hecho ? 'SI' : '',
    usuario: args.usuario,
    fecha: new Date().toISOString().slice(0, 10),
  };
  if (previas.some((f) => String(f.clave) === k)) {
    await updateRow(HOJA_CIERRE, 'clave', k, campos);
  } else {
    await appendRowObj(HOJA_CIERRE, {
      clave: k, anio: args.anio, mes: args.mes, paso: args.paso, ...campos,
    });
  }
}
