import { google, sheets_v4 } from 'googleapis';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

let _client: sheets_v4.Sheets | null = null;

// ── Reintento por límite de consultas ────────────────────────────────────────────────
//
// Google limita las lecturas de Sheets por minuto y por usuario. Cuando se pasa, contesta
// 429 "Quota exceeded for quota metric 'Read requests'" y la operación falla entera —
// facturar, por ejemplo, terminaba en "no se pudo emitir ninguna" por un límite que se
// libera solo en unos segundos.
//
// Es un error transitorio por definición, así que se reintenta con espera creciente
// (0,7s → 1,4s → 2,8s) más un pedacito al azar, para que dos pedidos que chocaron al mismo
// tiempo no vuelvan a chocar juntos. Si después de eso sigue fallando, el mensaje que sale
// explica qué pasó, en vez del texto de Google.
const ESPERA_INICIAL_MS = 700;
const MAX_INTENTOS = 4;

function esErrorDeCuota(e: any): boolean {
  const code = Number(e?.code ?? e?.response?.status ?? 0);
  const msg = String(e?.message || '');
  return code === 429 || /quota exceeded|rate limit|RESOURCE_EXHAUSTED/i.test(msg);
}

async function reintentando<T>(fn: () => Promise<T>): Promise<T> {
  let espera = ESPERA_INICIAL_MS;
  for (let intento = 1; ; intento++) {
    try {
      return await fn();
    } catch (e: any) {
      if (!esErrorDeCuota(e)) throw e;
      if (intento >= MAX_INTENTOS) {
        throw new Error('Google Sheets cortó por límite de consultas por minuto. Esperá un minuto y volvé a intentar — no se perdió nada de lo que ya se hizo.');
      }
      console.warn(`[sheets] límite de consultas, reintento ${intento} en ${espera} ms`);
      await new Promise((r) => setTimeout(r, espera + Math.floor(Math.random() * 300)));
      espera *= 2;
    }
  }
}

// Envuelve los métodos de la API que usa la app para que TODOS reintenten. Se hace acá y no
// en cada llamada porque hay una veintena de puntos de acceso y alcanza con que uno quede
// afuera para que vuelva el error.
function conReintentos(s: sheets_v4.Sheets): sheets_v4.Sheets {
  const envolver = (obj: any, metodos: string[]) => {
    for (const m of metodos) {
      const original = obj[m].bind(obj);
      obj[m] = (...args: any[]) => reintentando(() => original(...args));
    }
  };
  envolver(s.spreadsheets, ['get', 'batchUpdate']);
  envolver(s.spreadsheets.values, ['get', 'update', 'append', 'batchUpdate']);
  return s;
}

function getClient(): sheets_v4.Sheets {
  if (_client) return _client;
  const auth = new google.auth.JWT({
    email: SA_EMAIL, key: PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _client = conReintentos(google.sheets({ version: 'v4', auth }));
  return _client;
}

// Convierte un serial de fecha de Google Sheets (días desde 1899-12-30, el mismo epoch
// que usa Excel) a texto ISO "YYYY-MM-DD". Con UNFORMATTED_VALUE, cualquier celda que
// Sheets haya detectado/guardado como fecha (aunque se haya tipeado "2026-08-09") vuelve
// como este número en vez del texto formateado — sin esta conversión, todo lo que
// compara fechas como string (slice(0,7)==='YYYY-MM', etc.) deja de matchear y esas
// filas "desaparecen" en silencio de reportes filtrados por mes/fecha.
function serialFechaAISO(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Convierte una fracción de día de Google Sheets (celda con formato HORA, ej. "07:00" se
// guarda como 0.291666... = 7/24) a texto "HH:MM". Mismo problema que las fechas: con
// UNFORMATTED_VALUE una celda que Sheets reconoció como hora (aunque se haya tipeado
// "08:00") vuelve como esta fracción en vez del texto formateado — sin convertir, el
// cálculo de tardanzas (minDeHora en lib/personal.ts) leía la fracción como si fuera un
// número de horas cualquiera y todo el cómputo de "minutos tarde" quedaba desquiciado.
function fraccionDiaAHora(fraccion: number): string {
  const totalMin = Math.round(fraccion * 24 * 60);
  const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export async function readSheet<T = Record<string, any>>(sheetName: string): Promise<T[]> {
  const sheets = getClient();
  // valueRenderOption: 'UNFORMATTED_VALUE' — sin esto, Sheets devuelve el valor
  // FORMATEADO como texto (default de la API). Una celda numérica con separador de
  // miles (formato argentino, ej. 1.850) volvía como el string "1.850", y Number(...)
  // la interpreta como 1.85 (punto = decimal en JS) — achicaba cualquier cantidad
  // ≥1000 en una celda con ese formato por 1000.
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`, valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj: Record<string, any> = {};
    headers.forEach((header, idx) => {
      const raw = row[idx];
      const esFecha = /fecha/i.test(header);
      // "hora_" (singular) = un horario puntual tipo "08:00" (hora_entrada_esperada,
      // hora_salida_esperada). NO matchea "horas_" (plural, con 's' antes del guión) —
      // esos son cantidades de horas (horas_lv, horas_teoricas_quincena, etc.), un
      // número común, no una fracción de día.
      const esHoraDelDia = /^hora_/i.test(header);
      if (raw === undefined || raw === null || raw === '') { obj[header] = ''; }
      else if (esFecha && typeof raw === 'number') { obj[header] = serialFechaAISO(raw); }
      else if (esHoraDelDia && typeof raw === 'number') { obj[header] = fraccionDiaAHora(raw); }
      // Celda cargada como TEXTO (no como número nativo de Sheets — típicamente tipeada
      // directo en la planilla, o pegada desde Excel) con formato argentino de miles:
      // punto separando de a 3 dígitos, ej. "1.850" o "1.234.567". Hay que revisar esto
      // ANTES que la rama de abajo — si no, "1.850" cae en /^-?\d+(\.\d+)?$/ y
      // parseFloat lo interpreta como 1.85 (punto = decimal en JS), achicando por 1000
      // cualquier cantidad así tipeada (ej. stock en cámara "1850" mostrado como "1.85").
      else if (typeof raw === 'string' && /^-?\d{1,3}(\.\d{3})+,\d+$/.test(raw)) { obj[header] = parseFloat(raw.replace(/\./g, '').replace(',', '.')); }
      else if (typeof raw === 'string' && /^-?\d{1,3}(\.\d{3})+$/.test(raw)) { obj[header] = parseInt(raw.replace(/\./g, ''), 10); }
      else if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw)) { obj[header] = parseFloat(raw); }
      // Google Sheets devuelve los números con el separador decimal de la config
      // regional de la planilla — con configuración en español eso es COMA, no punto
      // ("0,201" en vez de "0.201"). Sin este segundo caso, esos valores quedaban como
      // texto y cualquier Number(...) sobre ellos daba NaN en silencio (comparaciones
      // ">0", sumas, etc. — ej. el pesaje testigo de un lote "desaparecía" de golpe).
      else if (typeof raw === 'string' && /^-?\d+,\d+$/.test(raw)) { obj[header] = parseFloat(raw.replace(',', '.')); }
      else { obj[header] = raw; }
    });
    return obj as T;
  });
}

export async function appendRow(sheetName: string, values: any[]): Promise<void> {
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [values] },
  });
}

// Append por NOMBRE de columna: lee el header y ubica cada campo en su columna.
// Inmune a cambios de orden o columnas nuevas en la planilla (a diferencia de appendRow posicional).
// Varias filas de una sola vez. Importa cuando se cargan muchas juntas —un resumen
// bancario son decenas de movimientos—: una llamada por fila se come la cuota de Sheets por
// minuto y tarda una eternidad.
export async function appendRowsObj(sheetName: string, objs: Record<string, any>[]): Promise<void> {
  if (!objs.length) return;
  const sheets = getClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!1:1` });
  const headers: string[] = (resp.data.values?.[0] as string[]) || [];
  if (!headers.length) throw new Error(`No se pudo leer el header de ${sheetName}`);
  const values = objs.map(obj => headers.map(h => (obj[h] !== undefined && obj[h] !== null ? obj[h] : '')));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`,
    valueInputOption: 'USER_ENTERED', requestBody: { values },
  });
}

export async function appendRowObj(sheetName: string, obj: Record<string, any>): Promise<void> {
  const sheets = getClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!1:1` });
  const headers: string[] = (resp.data.values?.[0] as string[]) || [];
  if (!headers.length) throw new Error(`No se pudo leer el header de ${sheetName}`);
  const row = headers.map(h => (obj[h] !== undefined && obj[h] !== null ? obj[h] : ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [row] },
  });
}

export async function appendRows(sheetName: string, rows: any[][]): Promise<void> {
  if (!rows.length) return;
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: rows },
  });
}

// Lee las filas crudas (array posicional) incluyendo el header.
export async function readRaw(sheetName: string): Promise<string[][]> {
  const sheets = getClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`, valueRenderOption: 'UNFORMATTED_VALUE' });
  return (resp.data.values as string[][]) || [];
}

// Reescribe una fila completa ubicando cada campo del obj en su columna por nombre.
export async function setRowByHeader(sheetName: string, rowNumber: number, headers: string[], obj: Record<string, any>): Promise<void> {
  const sheets = getClient();
  const row = headers.map(h => (obj[h] !== undefined && obj[h] !== null ? obj[h] : ''));
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A${rowNumber}:${colLetter(headers.length)}${rowNumber}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [row] },
  });
}

export async function updateRow(sheetName: string, keyColumn: string, keyValue: string, updates: Record<string, any>): Promise<boolean> {
  const sheets = getClient();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const rows = response.data.values;
  if (!rows || rows.length < 2) return false;
  const headers = rows[0];
  return updateRowWithRawData(sheets, headers, rows, sheetName, keyColumn, keyValue, updates);
}

// Actualiza múltiples filas con una sola lectura y un solo batchUpdate.
// Usar en lugar de llamar updateRow N veces seguidas.
export async function batchUpdateRows(
  sheetName: string,
  keyColumn: string,
  updates: Array<{ keyValue: string; updates: Record<string, any> }>,
  // Filas ya leídas, para no releer la hoja entera en cada llamada cuando se hacen varias
  // seguidas (facturar emite de a una y marca de a una). Solo se usa para ubicar filas
  // existentes por clave: como acá nunca se insertan ni se borran filas, los índices de
  // una lectura previa siguen valiendo.
  filasPrecargadas?: string[][],
): Promise<void> {
  if (!updates.length) return;
  const sheets = getClient();
  const rows = filasPrecargadas ?? (await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`, valueRenderOption: 'UNFORMATTED_VALUE',
  })).data.values;
  if (!rows || rows.length < 2) return;
  const headers = rows[0];
  const keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) throw new Error(`Columna ${keyColumn} no encontrada en ${sheetName}`);

  const data: { range: string; values: any[][] }[] = [];
  for (const { keyValue, updates: upd } of updates) {
    const rowIndex = rows.findIndex((r, idx) => idx > 0 && String(r[keyIndex]) === String(keyValue));
    if (rowIndex === -1) continue;
    const newRow = [...rows[rowIndex]];
    for (const [col, val] of Object.entries(upd)) {
      const colIdx = headers.indexOf(col);
      if (colIdx === -1) throw new Error(`Columna "${col}" no encontrada en hoja "${sheetName}". Agregá la columna y volvé a intentar.`);
      newRow[colIdx] = val;
    }
    while (newRow.length < headers.length) newRow.push('');
    // Si la fila leída traía datos sueltos en columnas más allá de las que define el
    // encabezado (una edición manual vieja, una columna borrada hace tiempo, etc.), hay
    // que descartarlos acá — si no, el ancho de la fila termina siendo mayor al rango
    // declarado (A:última columna del encabezado) y Sheets rechaza toda la escritura.
    newRow.length = headers.length;
    data.push({ range: `${sheetName}!A${rowIndex + 1}:${colLetter(headers.length)}${rowIndex + 1}`, values: [newRow] });
  }
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

function updateRowWithRawData(
  sheets: sheets_v4.Sheets, headers: string[], rows: string[][],
  sheetName: string, keyColumn: string, keyValue: string, updates: Record<string, any>
): Promise<boolean> {
  const keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) throw new Error(`Columna ${keyColumn} no encontrada en ${sheetName}`);
  const rowIndex = rows.findIndex((r, idx) => idx > 0 && String(r[keyIndex]) === String(keyValue));
  if (rowIndex === -1) return Promise.resolve(false);
  const newRow = [...rows[rowIndex]];
  for (const [col, val] of Object.entries(updates)) {
    const colIdx = headers.indexOf(col);
    if (colIdx === -1) throw new Error(`Columna "${col}" no encontrada en hoja "${sheetName}". Agregá la columna y volvé a intentar.`);
    newRow[colIdx] = val;
  }
  while (newRow.length < headers.length) newRow.push('');
  // Truncar columnas sueltas más allá del encabezado (ver mismo comentario en
  // batchUpdateRows) — si no, el ancho de la fila supera el rango declarado y Sheets
  // rechaza toda la escritura.
  newRow.length = headers.length;
  return sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A${rowIndex + 1}:${colLetter(headers.length)}${rowIndex + 1}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [newRow] },
  }).then(() => true);
}

function colLetter(col: number): string {
  let letter = '';
  while (col > 0) { const mod = (col - 1) % 26; letter = String.fromCharCode(65 + mod) + letter; col = Math.floor((col - 1) / 26); }
  return letter;
}

export async function deleteRow(sheetName: string, keyColumn: string, keyValue: string): Promise<boolean> {
  const sheets = getClient();
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = sheetMeta.data.sheets?.find((s) => s.properties?.title === sheetName);
  if (!sheet) throw new Error(`Pestaña ${sheetName} no encontrada`);
  const sheetId = sheet.properties?.sheetId;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const rows = response.data.values;
  if (!rows || rows.length < 2) return false;
  const headers = rows[0];
  const keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) return false;
  const rowIndex = rows.findIndex((r, idx) => idx > 0 && String(r[keyIndex]) === String(keyValue));
  if (rowIndex === -1) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] },
  });
  return true;
}

// Crea la pestaña con ese nombre (y el header dado) si todavía no existe — para
// features nuevas que necesitan una hoja propia sin depender de que alguien la arme
// a mano en Google Sheets primero. Idempotente: si ya existe, no hace nada.
export async function asegurarHoja(nombre: string, headers: string[]): Promise<void> {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existe = meta.data.sheets?.some((s) => s.properties?.title === nombre);
  if (existe) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: nombre } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `${nombre}!A1`,
    valueInputOption: 'RAW', requestBody: { values: [headers] },
  });
}

// Agrega una columna al final del encabezado de una hoja YA EXISTENTE si todavía no
// está — para sumarle un campo nuevo a una hoja vieja sin pedirle al usuario que edite
// la planilla a mano. Idempotente (no hace nada si la columna ya existe).
export async function asegurarColumna(nombre: string, columna: string): Promise<void> {
  const sheets = getClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${nombre}!1:1` });
  const headers: string[] = (resp.data.values?.[0] as string[]) || [];
  if (headers.includes(columna)) return;
  const nuevaCol = colLetter(headers.length + 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `${nombre}!${nuevaCol}1`,
    valueInputOption: 'RAW', requestBody: { values: [[columna]] },
  });
}

export async function readConfig(clave: string): Promise<string | number | null> {
  const items = await readSheet<{ clave: string; valor: any }>('Configuracion');
  const item = items.find((i) => i.clave === clave);
  return item ? item.valor : null;
}

export async function updateConfig(clave: string, valor: any): Promise<void> {
  await updateRow('Configuracion', 'clave', clave, { valor });
}
