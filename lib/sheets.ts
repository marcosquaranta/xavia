// lib/sheets.ts
// Cliente para leer y escribir en el Google Sheet de XaviaApp.
// Usa el Service Account configurado en las variables de entorno.

import { google, sheets_v4 } from 'googleapis';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!SHEET_ID || !SA_EMAIL || !PRIVATE_KEY) {
  // Esto se chequea al iniciar la app. Si falta algo, va a fallar al primer request.
  console.warn(
    '⚠ Variables de entorno de Google Sheets faltantes. Revisa GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY en .env.local'
  );
}

let _client: sheets_v4.Sheets | null = null;

function getClient(): sheets_v4.Sheets {
  if (_client) return _client;
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _client = google.sheets({ version: 'v4', auth });
  return _client;
}

/**
 * Lee todas las filas de una pestaña y las devuelve como array de objetos
 * usando la primera fila como nombres de columna.
 */
export async function readSheet<T = Record<string, any>>(
  sheetName: string
): Promise<T[]> {
  const sheets = getClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj: Record<string, any> = {};
    headers.forEach((header, idx) => {
      const raw = row[idx];
      if (raw === undefined || raw === null || raw === '') {
        obj[header] = '';
      } else if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw)) {
        // Convertir números almacenados como strings
        obj[header] = parseFloat(raw);
      } else {
        obj[header] = raw;
      }
    });
    return obj as T;
  });
}

/**
 * Agrega una fila al final de una pestaña.
 * Los valores deben venir en el orden correcto de las columnas.
 */
export async function appendRow(
  sheetName: string,
  values: any[]
): Promise<void> {
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

/**
 * Actualiza una fila específica buscando por una columna clave.
 * Por ejemplo: updateRow('Lotes', 'id_lote', 'N1L1-007', { fase_actual: 'fase_2' })
 */
export async function updateRow(
  sheetName: string,
  keyColumn: string,
  keyValue: string,
  updates: Record<string, any>
): Promise<boolean> {
  const sheets = getClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return false;

  const headers = rows[0];
  const keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) {
    throw new Error(`Columna ${keyColumn} no encontrada en ${sheetName}`);
  }

  const rowIndex = rows.findIndex(
    (r, idx) => idx > 0 && String(r[keyIndex]) === String(keyValue)
  );
  if (rowIndex === -1) return false;

  // Construir la fila actualizada manteniendo lo que no se modifica
  const currentRow = rows[rowIndex];
  const newRow = [...currentRow];
  for (const [col, val] of Object.entries(updates)) {
    const colIdx = headers.indexOf(col);
    if (colIdx >= 0) newRow[colIdx] = val;
  }

  // Asegurarse de que la fila tenga la longitud correcta
  while (newRow.length < headers.length) newRow.push('');

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A${rowIndex + 1}:${columnLetter(headers.length)}${
      rowIndex + 1
    }`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [newRow] },
  });

  return true;
}

/**
 * Helper para convertir un número de columna a letra (1 → A, 27 → AA, etc.)
 */
function columnLetter(col: number): string {
  let letter = '';
  while (col > 0) {
    const mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

/**
 * Borra una fila buscando por columna clave (solo admin).
 */
export async function deleteRow(
  sheetName: string,
  keyColumn: string,
  keyValue: string
): Promise<boolean> {
  const sheets = getClient();

  // Necesitamos el sheetId numérico para usar batchUpdate
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = sheetMeta.data.sheets?.find(
    (s) => s.properties?.title === sheetName
  );
  if (!sheet) throw new Error(`Pestaña ${sheetName} no encontrada`);
  const sheetId = sheet.properties?.sheetId;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  const rows = response.data.values;
  if (!rows || rows.length < 2) return false;

  const headers = rows[0];
  const keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) return false;

  const rowIndex = rows.findIndex(
    (r, idx) => idx > 0 && String(r[keyIndex]) === String(keyValue)
  );
  if (rowIndex === -1) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        },
      ],
    },
  });

  return true;
}

/**
 * Lee un valor de la pestaña Configuracion.
 * Útil para umbrales, prefijos y correlativos.
 */
export async function readConfig(clave: string): Promise<string | number | null> {
  const items = await readSheet<{ clave: string; valor: any }>('Configuracion');
  const item = items.find((i) => i.clave === clave);
  return item ? item.valor : null;
}

/**
 * Actualiza un valor en la pestaña Configuracion.
 */
export async function updateConfig(clave: string, valor: any): Promise<void> {
  await updateRow('Configuracion', 'clave', clave, { valor });
}
