import { fechaArgentinaHoy } from './ocupacion';
import type { RegistroProtocolo } from './types';

// ── Protocolo de aplicaciones (tareas fijas de temporada) ─────────────────────────────
//
// Especificación de Marcelo, sept-2026. Las tareas son FIJAS y se repiten solas: no se
// cargan a mano una por una, se calculan del calendario. Lo que sí es editable vive en la
// hoja Configuracion (ver CONFIG_*), porque la propia especificación lo pide: el ancla del
// ciclo de 14 días de Afital y la frecuencia de Serenade (30 días, 15 en verano).
//
// Dos cosas que definen el diseño:
//
// 1. Las condiciones ambientales (15-24 °C, 50-75% de humedad, sin radiación fuerte) son
//    un AVISO en pantalla, no un campo que se completa. El operario carga la temperatura y
//    la humedad REALES del momento, y recién ahí se puede verificar si la aplicación se
//    hizo dentro del rango — por eso cada registro guarda `fuera_de_rango` ya calculado,
//    en vez de pedirle a alguien que se acuerde de marcarlo.
// 2. Una tarea no se cierra a medias: sin los campos obligatorios de ESA tarea no se
//    registra (ver validarRegistro). Todo esto existe para poder controlar el cumplimiento
//    después, y un registro incompleto no sirve para eso.

export type TipoTareaProtocolo = 'foliar' | 'riego' | 'control';
export type CampoRegistro = 'temperatura' | 'humedad' | 'dosis' | 'producto' | 'ph' | 'conductividad';

// Rango ideal de aplicación foliar — el recuadro rojo de la especificación.
export const COND_TEMP_MIN = 15;
export const COND_TEMP_MAX = 24;
export const COND_HUM_MIN = 50;
export const COND_HUM_MAX = 75;
export const CONDICIONES_TXT = `Temperatura entre ${COND_TEMP_MIN} y ${COND_TEMP_MAX} °C · Humedad entre ${COND_HUM_MIN} y ${COND_HUM_MAX}% · Evitar alta radiación (aplicar temprano a la mañana o al atardecer). Si las condiciones están fuera de rango, NO aplicar.`;

// Alarma del agua de ósmosis inversa: cualquiera de los dos valores fuera de rango avisa a
// Marcelo y a Marcos (ver app/api/protocolo/registrar).
export const ALARMA_CONDUCTIVIDAD = 0.15; // mS/cm
export const ALARMA_PH = 7.8;

// Claves en la hoja Configuracion — editables desde /protocolo (admin).
export const CONFIG_ACTIVO = 'protocolo_activo';                 // 'SI' | 'NO' — apagar fuera de temporada
export const CONFIG_AFITAL_ANCLA = 'protocolo_afital_ancla';     // YYYY-MM-DD del primer miércoles de aplicación
export const CONFIG_SERENADE_DIAS = 'protocolo_serenade_dias';   // 30 (primavera) / 15 (verano)
export const CONFIG_SERENADE_ANCLA = 'protocolo_serenade_ancla'; // YYYY-MM-DD de la primera aplicación

export interface ConfigProtocolo {
  activo: boolean;
  afitalAncla: string | null;
  serenadeDias: number;
  serenadeAncla: string | null;
}
export const SERENADE_DIAS_DEFAULT = 30;

function soloFecha(s: string | null): string | null {
  const f = String(s || '').split(/[T ]/)[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
}

export function leerConfigProtocolo(filas: { clave: string; valor: any }[]): ConfigProtocolo {
  const val = (clave: string) => {
    const f = filas.find((r) => String(r.clave).trim() === clave);
    return f === undefined || f.valor === '' || f.valor === undefined || f.valor === null ? null : String(f.valor).trim();
  };
  const dias = Number(val(CONFIG_SERENADE_DIAS));
  return {
    // Por defecto ACTIVO: si la clave todavía no está en la planilla, las tareas aparecen
    // igual. Apagarlo tiene que ser una decisión explícita, no el estado de arranque.
    activo: (val(CONFIG_ACTIVO) ?? 'SI').toUpperCase() !== 'NO',
    afitalAncla: soloFecha(val(CONFIG_AFITAL_ANCLA)),
    serenadeDias: dias > 0 ? dias : SERENADE_DIAS_DEFAULT,
    serenadeAncla: soloFecha(val(CONFIG_SERENADE_ANCLA)),
  };
}

// Hoja donde se guardan los registros. Vive acá y no en el route porque un archivo de
// ruta de Next solo puede exportar handlers (GET/POST/…): cualquier otra export rompe el
// build con un error de tipos bastante críptico.
export const HOJA_REGISTROS = 'ProtocoloRegistros';
export const HEADERS_REGISTROS = [
  'id_registro', 'id_tarea', 'tipo_registro', 'fecha', 'hora', 'responsable', 'estado',
  'producto', 'dosis', 'temperatura', 'humedad', 'ph', 'conductividad',
  'fuera_de_rango', 'notas', 'usuario', 'creado',
];

export interface TareaProtocolo {
  id: string;
  nombre: string;
  tipo: TipoTareaProtocolo;
  detalle: string;         // qué es, en una línea, para el operario
  frecuenciaTxt: string;   // cómo se repite, en palabras
  campos: CampoRegistro[]; // además de responsable + fecha + hora, que son siempre obligatorios
  condicionesFoliares: boolean;
  requiereDecision?: boolean; // el sábado no se ejecuta sin que Marcelo defina qué se aplica
  opciones?: string[];
  producto?: string;
}

// 1=lunes … 6=sábado, 0=domingo (mismo criterio que Date.getDay()).
const LUNES = 1, MIERCOLES = 3, SABADO = 6;

export const TAREAS_PROTOCOLO: TareaProtocolo[] = [
  {
    id: 'foliar_calboron',
    nombre: 'Foliar CALBORÓN',
    tipo: 'foliar',
    producto: 'Calborón',
    detalle: 'Aplicación foliar de Calborón. Dosis según marbete.',
    frecuenciaTxt: 'Todos los lunes',
    campos: ['temperatura', 'humedad', 'dosis'],
    condicionesFoliares: true,
  },
  {
    id: 'foliar_afital',
    nombre: 'Foliar AFITAL',
    tipo: 'foliar',
    producto: 'Afital',
    detalle: 'Aplicación foliar de Afital. Dosis según marbete.',
    frecuenciaTxt: 'Miércoles de por medio (cada 14 días)',
    campos: ['temperatura', 'humedad', 'dosis'],
    condicionesFoliares: true,
  },
  {
    id: 'foliar_sabado',
    nombre: 'Foliar del sábado (a definir)',
    tipo: 'foliar',
    detalle: 'Aplicación opcional. La define Marcelo según el clima y el estado del cultivo — el operario no aplica sin esa confirmación.',
    frecuenciaTxt: 'Todos los sábados, si Marcelo la define',
    campos: ['producto', 'temperatura', 'humedad', 'dosis'],
    condicionesFoliares: true,
    requiereDecision: true,
    opciones: ['Tracer', 'Naturamin (bioestimulante)', 'Calborón (2da aplicación)', 'Otro'],
  },
  {
    id: 'riego_serenade',
    nombre: 'SERENADE en tanque de riego',
    tipo: 'riego',
    producto: 'Serenade',
    detalle: 'Va en el TANQUE DE RIEGO, no es foliar. Dosis según marbete.',
    frecuenciaTxt: 'Cada 30 días (15 en verano)',
    campos: ['dosis'],
    condicionesFoliares: false,
  },
  {
    id: 'control_instrumental',
    nombre: 'Control de instrumental',
    tipo: 'control',
    detalle: 'Verificar calibración y funcionamiento del peachímetro y del conductímetro.',
    frecuenciaTxt: 'Una vez por semana',
    campos: ['ph', 'conductividad'],
    condicionesFoliares: false,
  },
  {
    id: 'control_osmosis',
    nombre: 'Medición de agua de ósmosis inversa',
    tipo: 'control',
    detalle: 'Medir conductividad y pH del agua de ósmosis inversa.',
    frecuenciaTxt: 'Una vez por semana',
    campos: ['conductividad', 'ph'],
    condicionesFoliares: false,
  },
];

export function tareaPorId(id: string): TareaProtocolo | undefined {
  return TAREAS_PROTOCOLO.find((t) => t.id === id);
}
// Las dos tareas "una vez por semana, sin día fijo" se cuentan por semana calendario y no
// por día: aparecen todos los días hasta que se hacen, y vencen recién al cerrar la semana.
const SEMANALES_SIN_DIA = ['control_instrumental', 'control_osmosis'];
const esSemanalSinDia = (id: string) => SEMANALES_SIN_DIA.includes(id);

// ── Fechas ────────────────────────────────────────────────────────────────────────────
// Todo se maneja como string YYYY-MM-DD y se opera al mediodía, para que ningún
// corrimiento de huso mueva un día (misma regla que el resto de la app).
function d(fecha: string): Date { return new Date(fecha + 'T12:00:00'); }
function iso(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function sumarDias(fecha: string, dias: number): string {
  const dt = d(fecha); dt.setDate(dt.getDate() + dias); return iso(dt);
}
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((d(hasta).getTime() - d(desde).getTime()) / 86400000);
}
export function diaSemana(fecha: string): number { return d(fecha).getDay(); }
export function lunesDeSemana(fecha: string): string {
  const dt = d(fecha); const dow = dt.getDay();
  dt.setDate(dt.getDate() - (dow === 0 ? 6 : dow - 1));
  return iso(dt);
}

// ── Registros ─────────────────────────────────────────────────────────────────────────
const esEjecucion = (r: RegistroProtocolo) => String(r.tipo_registro) === 'ejecucion';
const esDecision = (r: RegistroProtocolo) => String(r.tipo_registro) === 'decision';
const fechaDe = (r: RegistroProtocolo) => String(r.fecha || '').split(/[T ]/)[0];

export function registroDelDia(idTarea: string, fecha: string, registros: RegistroProtocolo[]): RegistroProtocolo | undefined {
  return registros.find((r) => r.id_tarea === idTarea && esEjecucion(r) && fechaDe(r) === fecha);
}
export function decisionDelDia(idTarea: string, fecha: string, registros: RegistroProtocolo[]): RegistroProtocolo | undefined {
  return registros.find((r) => r.id_tarea === idTarea && esDecision(r) && fechaDe(r) === fecha);
}
export function hechaEnSemana(idTarea: string, fecha: string, registros: RegistroProtocolo[]): boolean {
  const lunes = lunesDeSemana(fecha);
  const domingo = sumarDias(lunes, 6);
  return registros.some((r) => r.id_tarea === idTarea && esEjecucion(r) && fechaDe(r) >= lunes && fechaDe(r) <= domingo);
}
export function ultimaEjecucion(idTarea: string, registros: RegistroProtocolo[], hasta?: string): RegistroProtocolo | undefined {
  return registros
    .filter((r) => r.id_tarea === idTarea && esEjecucion(r) && String(r.estado) !== 'no_aplica' && fechaDe(r) && (!hasta || fechaDe(r) <= hasta))
    .sort((a, b) => fechaDe(a).localeCompare(fechaDe(b)))
    .pop();
}

// ── ¿Corresponde esta tarea en esta fecha? ────────────────────────────────────────────
export function correspondeEnFecha(tarea: TareaProtocolo, fecha: string, cfg: ConfigProtocolo, registros: RegistroProtocolo[]): boolean {
  switch (tarea.id) {
    case 'foliar_calboron':
      return diaSemana(fecha) === LUNES;
    case 'foliar_sabado':
      return diaSemana(fecha) === SABADO;
    case 'foliar_afital': {
      if (diaSemana(fecha) !== MIERCOLES) return false;
      // Sin ancla cargada no se puede saber QUÉ miércoles toca: se muestran todos y la
      // pantalla avisa que falta definir el primero (mejor que esconder la tarea).
      if (!cfg.afitalAncla) return true;
      const dif = diasEntre(cfg.afitalAncla, fecha);
      return dif >= 0 && dif % 14 === 0;
    }
    case 'riego_serenade': {
      const ultima = ultimaEjecucion('riego_serenade', registros, fecha);
      const base = ultima ? fechaDe(ultima) : cfg.serenadeAncla;
      if (!base) return true; // nunca se aplicó y no hay ancla: toca ya
      return diasEntre(base, fecha) >= cfg.serenadeDias;
    }
    case 'control_instrumental':
    case 'control_osmosis':
      return !hechaEnSemana(tarea.id, fecha, registros);
    default:
      return false;
  }
}

export type EstadoTarea = 'pendiente' | 'hecha' | 'no_aplica' | 'sin_decidir' | 'vencida';

export interface InstanciaTarea {
  tarea: TareaProtocolo;
  fecha: string;
  estado: EstadoTarea;
  registro?: RegistroProtocolo;   // la ejecución, si ya se hizo
  decision?: RegistroProtocolo;   // el sábado: qué definió Marcelo
  productoDefinido?: string;      // producto a aplicar (fijo, o el que definió Marcelo)
  aviso?: string;                 // algo que falta configurar y hay que decir en pantalla
}

// Estado de una tarea en una fecha puntual. `hoy` separa "todavía se puede hacer" de "el
// día pasó y no se hizo" (vencida) — sin eso no hay control de cumplimiento posible.
export function estadoDeTarea(tarea: TareaProtocolo, fecha: string, cfg: ConfigProtocolo, registros: RegistroProtocolo[], hoy: string): InstanciaTarea {
  const registro = registroDelDia(tarea.id, fecha, registros);
  const decision = tarea.requiereDecision ? decisionDelDia(tarea.id, fecha, registros) : undefined;
  const aviso = tarea.id === 'foliar_afital' && !cfg.afitalAncla
    ? 'Falta definir el primer miércoles de aplicación para que el ciclo de 14 días se calcule solo.'
    : undefined;
  const base: InstanciaTarea = { tarea, fecha, estado: 'pendiente', registro, decision, aviso };

  if (registro) {
    return {
      ...base,
      estado: String(registro.estado) === 'no_aplica' ? 'no_aplica' : 'hecha',
      productoDefinido: String(registro.producto || tarea.producto || '') || undefined,
    };
  }
  if (decision) {
    if (String(decision.estado) === 'no_aplica') return { ...base, estado: 'no_aplica' };
    return {
      ...base,
      estado: fecha < hoy ? 'vencida' : 'pendiente',
      productoDefinido: String(decision.producto || '') || undefined,
    };
  }
  if (tarea.requiereDecision) {
    // Sin decisión de Marcelo el operario no puede ejecutar: no es "pendiente de hacer",
    // es "pendiente de definir", y son dos cosas distintas para quien mira el tablero.
    return { ...base, estado: fecha < hoy ? 'vencida' : 'sin_decidir' };
  }
  const vencida = esSemanalSinDia(tarea.id)
    ? lunesDeSemana(fecha) < lunesDeSemana(hoy)
    : fecha < hoy;
  return { ...base, estado: vencida ? 'vencida' : 'pendiente', productoDefinido: tarea.producto };
}

// Tareas que corresponden en una fecha (por defecto, hoy en Argentina).
export function tareasDelDia(fecha: string, cfg: ConfigProtocolo, registros: RegistroProtocolo[], hoy: string = fechaArgentinaHoy()): InstanciaTarea[] {
  if (!cfg.activo) return [];
  return TAREAS_PROTOCOLO
    .filter((t) => correspondeEnFecha(t, fecha, cfg, registros) || !!registroDelDia(t.id, fecha, registros) || !!decisionDelDia(t.id, fecha, registros))
    .map((t) => estadoDeTarea(t, fecha, cfg, registros, hoy));
}

// Tareas de días anteriores que quedaron sin registrar — el control de cumplimiento del
// día a día. `diasAtras` acota la ventana: lo más viejo ya no es accionable, es historial.
export function tareasVencidas(cfg: ConfigProtocolo, registros: RegistroProtocolo[], hoy: string = fechaArgentinaHoy(), diasAtras = 14): InstanciaTarea[] {
  if (!cfg.activo) return [];
  const out: InstanciaTarea[] = [];
  for (let i = 1; i <= diasAtras; i++) {
    const fecha = sumarDias(hoy, -i);
    for (const t of TAREAS_PROTOCOLO) {
      // Las semanales se evalúan aparte, una vez por semana cerrada, para no repetir la
      // misma pendiente siete veces.
      if (esSemanalSinDia(t.id)) continue;
      if (!correspondeEnFecha(t, fecha, cfg, registros)) continue;
      const inst = estadoDeTarea(t, fecha, cfg, registros, hoy);
      if (inst.estado === 'vencida') out.push(inst);
    }
  }
  const semanas = Math.max(1, Math.ceil(diasAtras / 7));
  for (let s = 1; s <= semanas; s++) {
    const fechaSemana = sumarDias(lunesDeSemana(hoy), -7 * s);
    for (const id of SEMANALES_SIN_DIA) {
      const t = tareaPorId(id)!;
      if (hechaEnSemana(id, fechaSemana, registros)) continue;
      out.push({ tarea: t, fecha: fechaSemana, estado: 'vencida' });
    }
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// ── Validación al registrar ───────────────────────────────────────────────────────────
export interface DatosRegistro {
  id_tarea: string;
  tipo_registro: 'ejecucion' | 'decision';
  fecha: string;
  hora?: string;
  responsable?: string;
  estado?: 'hecha' | 'no_aplica';
  producto?: string;
  dosis?: string;
  temperatura?: number | string;
  humedad?: number | string;
  ph?: number | string;
  conductividad?: number | string;
  notas?: string;
}

const NOMBRE_CAMPO: Record<CampoRegistro, string> = {
  temperatura: 'temperatura (°C)',
  humedad: 'humedad (%)',
  dosis: 'dosis aplicada',
  producto: 'producto',
  ph: 'pH',
  conductividad: 'conductividad (mS/cm)',
};

// Devuelve la lista de lo que falta. Vacía = se puede guardar. Una tarea no se cierra a
// medias: sin estos campos el registro no sirve para controlar nada después.
export function validarRegistro(datos: DatosRegistro): string[] {
  const faltan: string[] = [];
  const tarea = tareaPorId(datos.id_tarea);
  if (!tarea) return ['La tarea no existe.'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datos.fecha || ''))) faltan.push('fecha');

  if (datos.tipo_registro === 'decision') {
    // Marcelo define: o elige producto, o dice que esta semana no se aplica.
    if (datos.estado === 'no_aplica') return faltan;
    if (!String(datos.producto || '').trim()) faltan.push('producto a aplicar');
    return faltan;
  }

  // Marcar "no se aplicó" no exige los datos de la aplicación, pero sí quién y cuándo lo
  // decidió: si no, no queda registro de por qué ese día está en blanco.
  if (!String(datos.responsable || '').trim()) faltan.push('responsable');
  if (!/^\d{1,2}:\d{2}$/.test(String(datos.hora || ''))) faltan.push('hora');
  if (datos.estado === 'no_aplica') return faltan;

  for (const campo of tarea.campos) {
    const v = (datos as any)[campo];
    if (campo === 'dosis' || campo === 'producto') {
      if (!String(v ?? '').trim()) faltan.push(NOMBRE_CAMPO[campo]);
    } else if (v === '' || v === undefined || v === null || isNaN(Number(v))) {
      faltan.push(NOMBRE_CAMPO[campo]);
    }
  }
  return faltan;
}

// ── Rangos: se calculan al guardar, no se le piden a nadie ────────────────────────────
export function fueraDeRangoFoliar(temperatura: any, humedad: any): boolean {
  const t = Number(temperatura), h = Number(humedad);
  if (isNaN(t) || isNaN(h)) return false;
  return t < COND_TEMP_MIN || t > COND_TEMP_MAX || h < COND_HUM_MIN || h > COND_HUM_MAX;
}
export function alarmaOsmosis(conductividad: any, ph: any): { alarma: boolean; motivos: string[] } {
  const c = Number(conductividad), p = Number(ph);
  const motivos: string[] = [];
  if (!isNaN(c) && c > ALARMA_CONDUCTIVIDAD) motivos.push(`conductividad ${c} mS/cm (límite ${ALARMA_CONDUCTIVIDAD})`);
  if (!isNaN(p) && p > ALARMA_PH) motivos.push(`pH ${p} (límite ${ALARMA_PH})`);
  return { alarma: motivos.length > 0, motivos };
}

// Marca de "fuera de rango" que se guarda en la fila, según el tipo de tarea.
export function calcularFueraDeRango(datos: DatosRegistro): boolean {
  const tarea = tareaPorId(datos.id_tarea);
  if (!tarea || datos.tipo_registro !== 'ejecucion' || datos.estado === 'no_aplica') return false;
  if (tarea.condicionesFoliares) return fueraDeRangoFoliar(datos.temperatura, datos.humedad);
  if (datos.id_tarea === 'control_osmosis') return alarmaOsmosis(datos.conductividad, datos.ph).alarma;
  return false;
}

// ── Cumplimiento ──────────────────────────────────────────────────────────────────────
export interface CumplimientoTarea {
  tarea: TareaProtocolo;
  correspondian: number;
  hechas: number;
  noAplica: number;
  pendientes: number;   // del período que ya pasó y quedaron sin registrar
  fueraDeRango: number; // hechas, pero con las condiciones fuera del rango recomendado
  pct: number | null;   // hechas + no_aplica sobre las que correspondían
}

// Cumplimiento por tarea en un rango [desde, hasta] (inclusive). "Cumplida" incluye las
// marcadas como "no se aplica": lo que se controla es que haya una DECISIÓN registrada
// cada vez que correspondía, no que se haya aplicado siempre.
export function cumplimientoProtocolo(desde: string, hasta: string, cfg: ConfigProtocolo, registros: RegistroProtocolo[], hoy: string = fechaArgentinaHoy()): CumplimientoTarea[] {
  return TAREAS_PROTOCOLO.map((tarea) => {
    let correspondian = 0, hechas = 0, noAplica = 0, pendientes = 0, fueraDeRango = 0;
    const semanalesVistas = new Set<string>();
    for (let fecha = desde; fecha <= hasta; fecha = sumarDias(fecha, 1)) {
      if (esSemanalSinDia(tarea.id)) {
        const lunes = lunesDeSemana(fecha);
        if (semanalesVistas.has(lunes)) continue;
        semanalesVistas.add(lunes);
        correspondian++;
        if (hechaEnSemana(tarea.id, fecha, registros)) {
          hechas++;
          const reg = registros.find((r) => r.id_tarea === tarea.id && esEjecucion(r) && lunesDeSemana(fechaDe(r)) === lunes);
          if (reg && String(reg.fuera_de_rango) === 'SI') fueraDeRango++;
        } else if (lunes < lunesDeSemana(hoy)) pendientes++;
        continue;
      }
      const reg = registroDelDia(tarea.id, fecha, registros);
      if (!correspondeEnFecha(tarea, fecha, cfg, registros) && !reg) continue;
      correspondian++;
      if (reg) {
        if (String(reg.estado) === 'no_aplica') noAplica++;
        else { hechas++; if (String(reg.fuera_de_rango) === 'SI') fueraDeRango++; }
      } else {
        const dec = decisionDelDia(tarea.id, fecha, registros);
        if (dec && String(dec.estado) === 'no_aplica') noAplica++;
        else if (fecha < hoy) pendientes++;
      }
    }
    const cerradas = hechas + noAplica;
    return {
      tarea, correspondian, hechas, noAplica, pendientes, fueraDeRango,
      pct: correspondian > 0 ? Math.round((cerradas / correspondian) * 100) : null,
    };
  });
}
