import type { RegistroCrossChex } from './crosschex';
import { fechaArg } from './personal';
import { asegurarHoja, readSheet, updateRow, appendRowObj } from './sheets';

// ── Caché local de fichajes de CrossChex ────────────────────────────────────────────
// CrossChex limita a 1 pedido cada 15 segundos (ver lib/crosschex.ts) y ese límite aplica
// a CADA pedido, token y páginas incluidos: pedirle una quincena entera son 4-5 pedidos
// encadenados, o sea ~60-75 segundos. Mientras eso se hacía en vivo, cualquier pantalla
// que mostrara asistencia (el banner de tardanzas del home, Admin → Personal) quedaba
// colgada todo ese tiempo.
//
// Solución: un cron diario es el ÚNICO que le habla a CrossChex, y guarda los fichajes
// crudos acá. Todas las pantallas leen esta hoja, que es una lectura de Sheets normal
// (instantánea) — ver app/api/cron/crosschex-diario/route.ts.
//
// Una fila por empleado y por día, con los horarios del día concatenados. Se guarda el
// fichaje CRUDO (ISO con offset) y no un cálculo ya hecho, para que si mañana cambia la
// forma de calcular horas o tardanzas se pueda recalcular todo sobre lo ya guardado, sin
// volver a pedirle nada a CrossChex.
export const HOJA_FICHAJES = 'FichajesDiarios';
// `clave` (fecha__workno) es el id único de la fila: updateRow busca por UNA sola
// columna, y acá la identidad natural son dos (un empleado tiene una fila por día).
export const HEADERS_FICHAJES = ['clave', 'fecha', 'workno', 'nombre', 'checks', 'actualizado'];

export interface FichajeDiaRow {
  clave: string;   // fecha__workno
  fecha: string;    // YYYY-MM-DD (día en Argentina)
  workno: string;
  nombre: string;
  checks: string;   // ISOs separados por "|", en orden
  actualizado: string;
}

const SEP = '|';

// Reconstruye los RegistroCrossChex a partir de las filas cacheadas, para poder seguir
// usando tal cual las funciones de lib/personal.ts (calcularResumenQuincena, etc.) sin
// tocarlas: esperan la misma forma que devuelve la API.
export function registrosDesdeCache(filas: FichajeDiaRow[], desde?: string, hasta?: string): RegistroCrossChex[] {
  const out: RegistroCrossChex[] = [];
  for (const f of filas) {
    const fecha = String(f.fecha || '').slice(0, 10);
    if (!fecha) continue;
    if (desde && fecha < desde) continue;
    if (hasta && fecha > hasta) continue;
    const workno = String(f.workno || '');
    const nombre = String(f.nombre || '');
    for (const iso of String(f.checks || '').split(SEP).map((s) => s.trim()).filter(Boolean)) {
      out.push({
        uuid: `cache-${workno}-${iso}`,
        checktype: 0,
        checktime: iso,
        device: { serial_number: '', name: 'cache' },
        employee: { first_name: nombre, last_name: '', workno },
      });
    }
  }
  return out;
}

// Lee la caché completa (con el filtro de rango aplicado). Nunca tira error: si la hoja
// todavía no existe devuelve vacío, y quien llama decide qué mostrar.
export async function leerFichajesCache(desde?: string, hasta?: string): Promise<RegistroCrossChex[]> {
  const filas = await readSheet<FichajeDiaRow>(HOJA_FICHAJES).catch(() => [] as FichajeDiaRow[]);
  return registrosDesdeCache(filas, desde, hasta);
}

// Días (YYYY-MM-DD) que YA tienen al menos una fila cacheada — para poder avisar en
// pantalla si el rango que se está mirando todavía no se sincronizó.
export async function diasEnCache(): Promise<Set<string>> {
  const filas = await readSheet<FichajeDiaRow>(HOJA_FICHAJES).catch(() => [] as FichajeDiaRow[]);
  return new Set(filas.map((f) => String(f.fecha || '').slice(0, 10)).filter(Boolean));
}

// Guarda/actualiza los fichajes de un rango. Reemplaza por completo las filas de los días
// que vienen en `registros` (upsert por fecha+workno), así un día que se re-sincroniza
// queda con los datos nuevos y no duplica.
export async function guardarFichajes(registros: RegistroCrossChex[]): Promise<{ filas: number; dias: number }> {
  await asegurarHoja(HOJA_FICHAJES, HEADERS_FICHAJES);

  // Agrupar por día + empleado, ordenando los horarios del día
  const porClave = new Map<string, { fecha: string; workno: string; nombre: string; isos: string[] }>();
  for (const r of registros) {
    const iso = String(r.checktime || '');
    if (!iso) continue;
    const fecha = fechaArg(iso);
    const workno = String(r.employee?.workno || '');
    if (!fecha || !workno) continue;
    const clave = `${fecha}__${workno}`;
    if (!porClave.has(clave)) {
      const nombre = [r.employee?.first_name, r.employee?.last_name].filter(Boolean).join(' ').trim();
      porClave.set(clave, { fecha, workno, nombre, isos: [] });
    }
    porClave.get(clave)!.isos.push(iso);
  }

  const existentes = await readSheet<FichajeDiaRow>(HOJA_FICHAJES).catch(() => [] as FichajeDiaRow[]);
  const porClaveExistente = new Map(existentes.map((f) => [String(f.clave || ''), f]));

  const actualizado = new Date().toISOString();
  let filas = 0;
  const dias = new Set<string>();
  for (const [clave, v] of porClave) {
    const checks = v.isos.sort().join(SEP);
    dias.add(v.fecha);
    filas++;
    const vieja = porClaveExistente.get(clave);
    if (vieja) {
      // Si el día no cambió, no se reescribe la fila (menos escrituras a Sheets).
      if (String(vieja.checks || '') === checks) continue;
      await updateRow(HOJA_FICHAJES, 'clave', clave, { checks, nombre: v.nombre, actualizado });
    } else {
      await appendRowObj(HOJA_FICHAJES, { clave, fecha: v.fecha, workno: v.workno, nombre: v.nombre, checks, actualizado });
    }
  }
  return { filas, dias: dias.size };
}
