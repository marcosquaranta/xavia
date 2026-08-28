import { readRaw } from './sheets';

// ── Backup automático de los datos ──────────────────────────────────────────────────
// La planilla de Google es lo único del sistema que NO se puede reconstruir: el código
// está en GitHub y en el ZIP offline, los secretos se regeneran, pero cada lote, cosecha,
// venta y fichaje vive en un solo lado. Esto lo saca de ahí sin intervención humana.
//
// Se exporta cada hoja a CSV tal cual está (readRaw, sin interpretar tipos ni fechas) y se
// manda por mail como adjuntos. La gracia de mandarlo por mail es que el backup termina
// FUERA de Google Drive: si el problema es la cuenta de Google, una copia dentro de Drive
// no sirve de nada. Por eso conviene que BACKUP_EMAIL_TO sea una casilla que no dependa de
// esa misma cuenta.

export const HOJAS_A_RESPALDAR = [
  'Lotes', 'Movimientos', 'Ventas', 'VentasHistoricas', 'Clientes', 'Precios',
  'PedidosFijos', 'Gastos', 'Stocks', 'Articulos', 'StockCamara', 'Semillas',
  'Variedades', 'Ubicaciones', 'OcupacionHistorial', 'CajonesMovimientos',
  'Empleados', 'PersonalQuincena', 'FichajesDiarios', 'ProductividadDiaria',
  'Kilometraje', 'Usuarios', 'Configuracion',
] as const;

// Límite conservador: Resend acepta hasta ~40MB por mail, pero el adjunto viaja en base64
// (+33% de tamaño). Si se pasa, es mejor avisar que mandar un mail que va a rebotar.
const MAX_MB_ADJUNTOS = 15;

function celdaCsv(v: any): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface HojaExportada { nombre: string; csv: string; filas: number; error?: string }

// Exporta cada hoja a CSV. Una hoja que falla (no existe todavía, permisos, etc.) no
// aborta el backup entero: queda registrada con su error y el resto se manda igual —
// perder una hoja es mucho mejor que perder el backup completo por una.
export async function exportarHojas(): Promise<HojaExportada[]> {
  const out: HojaExportada[] = [];
  for (const nombre of HOJAS_A_RESPALDAR) {
    try {
      const filas = await readRaw(nombre);
      const csv = filas.map((f) => f.map(celdaCsv).join(',')).join('\r\n');
      out.push({ nombre, csv, filas: Math.max(0, filas.length - 1) });
    } catch (e: any) {
      out.push({ nombre, csv: '', filas: 0, error: e?.message || 'no se pudo leer' });
    }
  }
  return out;
}

export interface ResultadoBackup {
  ok: boolean;
  error?: string;
  hojas?: number;
  filas?: number;
  mb?: number;
  fallidas?: string[];
}

export async function enviarBackupPorMail(): Promise<ResultadoBackup> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' };
  // Idealmente una casilla que NO sea de la misma cuenta de Google que la planilla — si
  // no, el backup queda expuesto exactamente al mismo riesgo que quiere cubrir.
  const destino = process.env.BACKUP_EMAIL_TO || 'administracion@xavia.com.ar';

  try {
    const hojas = await exportarHojas();
    const okHojas = hojas.filter((h) => !h.error && h.csv.length > 0);
    const fallidas = hojas.filter((h) => h.error).map((h) => `${h.nombre} (${h.error})`);
    if (okHojas.length === 0) return { ok: false, error: 'No se pudo leer ninguna hoja', fallidas };

    const adjuntos = okHojas.map((h) => ({
      filename: `${h.nombre}.csv`,
      content: Buffer.from('﻿' + h.csv, 'utf8').toString('base64'), // BOM: Excel abre bien los acentos
    }));
    const bytes = adjuntos.reduce((a, x) => a + x.content.length, 0);
    const mb = Math.round((bytes / 1024 / 1024) * 100) / 100;
    if (mb > MAX_MB_ADJUNTOS) {
      return { ok: false, error: `El backup pesa ${mb} MB, por encima del límite de ${MAX_MB_ADJUNTOS} MB`, mb };
    }

    const totalFilas = okHojas.reduce((a, h) => a + h.filas, 0);
    const fecha = new Date().toISOString().slice(0, 10);
    const detalle = okHojas
      .map((h) => `<tr><td style="padding:3px 10px 3px 0">${h.nombre}</td><td style="padding:3px 0;text-align:right;color:#6b7280">${h.filas.toLocaleString('es-AR')}</td></tr>`)
      .join('');

    const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:600px">
      <h2 style="margin:0 0 4px">Backup de datos — Xavia</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:13px">${fecha}</p>
      <p style="font-size:13px;line-height:1.6">
        Adjunto va una copia de las <strong>${okHojas.length} hojas</strong> de la planilla
        (<strong>${totalFilas.toLocaleString('es-AR')} filas</strong> en total), una por archivo CSV.
        Se abren directo en Excel.
      </p>
      <p style="font-size:13px;line-height:1.6;background:#fffbeb;border:1px solid #fde68a;padding:10px 12px;border-radius:6px">
        <strong>Guardá este mail.</strong> Es la única copia de los datos que vive fuera de Google Drive.
        Si algún día se pierde la planilla o la cuenta, se reconstruye desde acá.
      </p>
      <table style="border-collapse:collapse;font-size:12px;margin-top:8px">
        <thead><tr style="background:#f5f5f5"><th style="padding:4px 10px 4px 0;text-align:left">Hoja</th><th style="padding:4px 0;text-align:right">Filas</th></tr></thead>
        <tbody>${detalle}</tbody>
      </table>
      ${fallidas.length > 0 ? `<p style="margin-top:14px;font-size:12px;color:#dc2626">No se pudieron leer: ${fallidas.join(' · ')}</p>` : ''}
      <p style="margin-top:16px;font-size:11px;color:#9ca3af">Backup automático · ${mb} MB</p>
    </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: [destino],
        subject: `Backup de datos — Xavia — ${fecha}`,
        html,
        attachments: adjuntos,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: (err as any).message || `HTTP ${res.status}`, mb };
    }
    return { ok: true, hojas: okHojas.length, filas: totalFilas, mb, fallidas: fallidas.length ? fallidas : undefined };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error al generar el backup' };
  }
}
