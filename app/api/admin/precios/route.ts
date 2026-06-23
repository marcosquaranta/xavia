import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { appendRow, readSheet } from '@/lib/sheets';
import type { PrecioVenta } from '@/lib/types';

// Upsert de precio por id_control + sucursal_obs
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { id_control, nombre_cliente, sucursal_obs, rucula, lechuga_crespa, hoja_roble, bandeja_rucula, albahaca, rucula_kg, lechuga_kg } = await req.json();
    if (!id_control || !sucursal_obs) return NextResponse.json({ error: 'datos_incompletos' }, { status: 400 });

    const precios = await readSheet<PrecioVenta>('Precios');
    const existe = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal_obs);
    // Cada campo: si viene en el request se usa, si no se preserva el valor existente
    const campo = (val: any, key: keyof PrecioVenta) => val !== undefined ? Number(val) || 0 : Number((existe as any)?.[key]) || 0;

    // updateRow solo soporta una clave — como Precios no tiene id único usamos índice directo via sheets
    const { google, sheets_v4 } = await import('googleapis');
    const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const auth = new google.auth.JWT({ email: SA_EMAIL, key: PRIVATE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version: 'v4', auth });

    const newValues = [
      String(id_control), nombre_cliente || (existe as any)?.nombre_cliente || '', sucursal_obs,
      campo(rucula, 'rucula'), campo(lechuga_crespa, 'lechuga_crespa'), campo(hoja_roble, 'hoja_roble'),
      campo(bandeja_rucula, 'bandeja_rucula'), campo(albahaca, 'albahaca'),
      campo(rucula_kg, 'rucula_kg'), campo(lechuga_kg, 'lechuga_kg'),
    ];

    if (existe) {
      // Encontrar fila exacta en el sheet
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID!, range: 'Precios!A:J' });
      const rows = res.data.values || [];
      const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[0]) === String(id_control) && r[2] === sucursal_obs);
      if (rowIdx > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID!, range: `Precios!A${rowIdx + 1}:J${rowIdx + 1}`,
          valueInputOption: 'USER_ENTERED', requestBody: { values: [newValues] },
        });
      }
    } else {
      await appendRow('Precios', newValues);
    }

    return NextResponse.json({ ok: true, accion: existe ? 'actualizado' : 'creado' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
