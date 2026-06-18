import { google, sheets_v4 } from 'googleapis';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

let _client: sheets_v4.Sheets | null = null;

function getClient(): sheets_v4.Sheets {
  if (_client) return _client;
  const auth = new google.auth.JWT({
    email: SA_EMAIL, key: PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _client = google.sheets({ version: 'v4', auth });
  return _client;
}

export async function readSheet<T = Record<string, any>>(sheetName: string): Promise<T[]> {
  const sheets = getClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`,
  });
  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj: Record<string, any> = {};
    headers.forEach((header, idx) => {
      const raw = row[idx];
      if (raw === undefined || raw === null || raw === '') { obj[header] = ''; }
      else if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw)) { obj[header] = parseFloat(raw); }
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

export async function appendRows(sheetName: string, rows: any[][]): Promise<void> {
  if (!rows.length) return;
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: rows },
  });
}

export async function updateRow(sheetName: string, keyColumn: string, keyValue: string, updates: Record<string, any>): Promise<boolean> {
  const sheets = getClient();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH` });
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
  updates: Array<{ keyValue: string; updates: Record<string, any> }>
): Promise<void> {
  if (!updates.length) return;
  const sheets = getClient();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH` });
  const rows = response.data.values;
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
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:AH` });
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

export async function readConfig(clave: string): Promise<string | number | null> {
  const items = await readSheet<{ clave: string; valor: any }>('Configuracion');
  const item = items.find((i) => i.clave === clave);
  return item ? item.valor : null;
}

export async function updateConfig(clave: string, valor: any): Promise<void> {
  await updateRow('Configuracion', 'clave', clave, { valor });
}
