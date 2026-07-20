import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow, batchUpdateRows } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia, ConfigItem, Lote } from '@/lib/types';
import * as XLSX from 'xlsx';
// Email via Resend API (sin dependencias extra)

const COLS = ['NUMERODECONTROL','CLIENTE','TIPO','NUMERO','FECHA','VENCIMIENTODELCOBRO',
  'COMPROBANTEASOCIADO','MONEDA','COTIZACION','OBSERVACIONES','PRODUCTOSERVICIO',
  'CENTRODECOSTO','PRODUCTOOBSERVACION','CANTIDAD','PRECIO','DESCUENTO','IMPORTE','IVA'];

const PRODS = [
  { key: 'rucula',         xubio: 'Rucula Hidropónica' },
  { key: 'lechuga_crespa', xubio: 'Lechuga Crespa Hidropónica' },
  { key: 'hoja_roble',     xubio: 'Lechuga Hoja de Roble Verde Hidropónica' },
  { key: 'bandeja_rucula', xubio: 'Rucula Bandeja' },
  { key: 'albahaca',       xubio: 'Albahaca Hidropónica' },
] as const;

// Productos por KG (clientes que facturan por cajón, ej. Select Food). lechuga_kg queda
// para no perder ventas cargadas antes del split crespa/roble.
const PRODS_KG = [
  { key: 'rucula_kg',          xubio: 'Rucula Hidropónica KG' },
  { key: 'lechuga_kg',         xubio: 'Lechuga Hidropónica KG' },
  { key: 'lechuga_kg_crespa',  xubio: 'KG Lechuga Crespa' },
  { key: 'lechuga_kg_roble',   xubio: 'KG Lechuga Hoja de Roble' },
] as const;


function getPrecio(precios: PrecioVenta[], id_control: string, sucursal: string, key: string, clienteSucursales?: string): number {
  // Exact match por sucursal
  let row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal);
  // Fallback: probar cada sucursal configurada en el cliente
  if (!row && clienteSucursales) {
    for (const s of clienteSucursales.split('|').map(s => s.trim()).filter(Boolean)) {
      row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === s);
      if (row) break;
    }
  }
  // Fallback final: primer precio para este cliente
  if (!row) row = precios.find(p => String(p.id_control) === String(id_control));
  if (!row) return 0;
  return Number((row as any)[key] || 0);
}

function fmtFecha(d: Date) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }

// Abrevia un nombre de cliente: sin acentos, sin formas societarias, 1-2 palabras significativas
function abreviarCliente(nombre: string): string {
  const limpio = String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b(S\.?A\.?S?|S\.?R\.?L\.?|LTDA|SACI|S\.?H\.?|EIRL)\b/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stop = ['LA','EL','LOS','LAS','DE','DEL','Y','SAN'];
  const palabras = limpio.split(' ').filter(w => w && !stop.includes(w));
  return (palabras.slice(0, 2).join(' ') || limpio).trim();
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const { fecha, fechaFactura, fechasCliente = {}, correlaA, correlaB, enviarEmail = true, id_exportacion: idExpReexport } = await req.json();
    const fechaBase = fechaFactura || fecha;
    const [clientes, precios, ventas, config, lotes] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'),
      readSheet<PrecioVenta>('Precios'),
      readSheet<VentaDia>('Ventas'),
      readSheet<ConfigItem>('Config'),
      readSheet<Lote>('Lotes'),
    ]);

    // Re-export: usar filas de la exportación anterior. Export nuevo: solo filas no exportadas.
    const ventasFecha = idExpReexport
      ? ventas.filter(v => v.exportado === idExpReexport)
      : ventas.filter(v => v.fecha === fecha && (!v.exportado || v.exportado === ''));
    if (!ventasFecha.length) return NextResponse.json({ error: 'Sin ventas para exportar' }, { status: 400 });

    // Generar ID de exportación (nuevo o reusar el existente para re-export)
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    const id_exportacion = idExpReexport || `EXP-${fecha.replace(/-/g,'')}-${hhmm}`;

    // Usar correlativo manual si se provee, sino leer de Config
    // El frontend manda correlaA = "próximo número a usar", el backend hace ++lastA antes de usarlo,
    // así que arrancamos en correlaA-1 para que el primer ++lastA dé correlaA.
    let lastA = correlaA !== undefined ? Number(correlaA) - 1 : Number(config.find(c => c.clave === 'last_factura_a')?.valor || 665);
    let lastB = correlaB !== undefined ? Number(correlaB) - 1 : Number(config.find(c => c.clave === 'last_factura_b')?.valor || 575);

    const initialA = lastA, initialB = lastB;
    const fechaDate = new Date(fecha + 'T12:00:00');
    const wb = XLSX.utils.book_new();
    const rows: any[][] = [COLS];
    const headerRows: number[] = [];

    // Agrupar ventas por id_control
    const porControl = new Map<string, VentaDia[]>();
    for (const v of ventasFecha) {
      const arr = porControl.get(v.id_control) || [];
      arr.push(v); porControl.set(v.id_control, arr);
    }

    // Ordenar por id_control
    const controlesOrden = clientes.map(c => c.id_control);
    const controlesUsados = [...porControl.keys()].sort((a,b) =>
      controlesOrden.indexOf(a) - controlesOrden.indexOf(b)
    );
    let facturasGeneradas = 0;
    const clientesFacturados: string[] = [];

    // Trazabilidad: lotes cosechados en la fecha (±1 día)
    function lotesParaCliente(idControl: string, fechaFact: string): string {
      const fechaD = new Date(fechaFact + 'T12:00:00');
      const d1 = new Date(fechaD); d1.setDate(fechaD.getDate() - 1);
      const d2 = new Date(fechaD); d2.setDate(fechaD.getDate() + 1);
      // Determinar qué cultivos compró este cliente en esta venta
      const lineasCliente = ventasFecha.filter(v => v.id_control === idControl);
      const compraLechuga = lineasCliente.some(l => Number(l.lechuga_crespa || 0) + Number(l.hoja_roble || 0) > 0);
      const compraRucula  = lineasCliente.some(l => Number(l.rucula || 0) + Number(l.bandeja_rucula || 0) > 0);
      const compraAlbahaca = lineasCliente.some(l => Number(l.albahaca || 0) > 0);

      const lotesDesc: string[] = [];
      for (const l of lotes) {
        if (l.estado !== 'cosechado') continue;
        const fc = String(l.fecha_cosecha || l.fecha_ult_movimiento || '').split(/[\sT]/)[0];
        if (!fc) continue;
        const fd = new Date(fc + 'T12:00:00');
        if (fd < d1 || fd > d2) continue;
        const v = String(l.variedad || '').toLowerCase();
        const esRucula = v.includes('rucula') || v.includes('rúcula');
        const esAlbahaca = v.includes('albahaca');
        const esLechuga = !esRucula && !esAlbahaca;
        if (esLechuga && !compraLechuga) continue;
        if (esRucula && !compraRucula) continue;
        if (esAlbahaca && !compraAlbahaca) continue;
        const varCorta = String(l.variedad || '').split(' ').slice(0, 2).join(' ');
        lotesDesc.push(`${l.id_lote} (${varCorta})`);
      }
      return lotesDesc.length ? 'Lotes: ' + lotesDesc.join(' · ') : '';
    }

    const getFechaCliente = (idControl: string): Date => {
      const f = (fechasCliente as Record<string,string>)[idControl] || fechaBase;
      return new Date(f + 'T12:00:00');
    };

    for (const idControl of controlesUsados) {
      const lineas = porControl.get(idControl)!;
      const cliente = clientes.find(c => c.id_control === idControl);
      if (!cliente) continue;

      // Verificar si hay alguna cantidad > 0 (paquetes o KG)
      const tieneVentas = lineas.some(l =>
        ['rucula','lechuga_crespa','hoja_roble','bandeja_rucula','albahaca','rucula_kg','lechuga_kg','lechuga_kg_crespa','lechuga_kg_roble']
          .some(k => Number((l as any)[k]) > 0)
      );
      if (!tieneVentas) continue;
      facturasGeneradas++;
      clientesFacturados.push(cliente.nombre_display || cliente.nombre_xubio || idControl);

      const esA = cliente.tipo_factura === 'A';
      const pv = Number(cliente.punto_venta);
      const num = esA ? ++lastA : ++lastB;
      const numFmt = `${cliente.tipo_factura}-${String(pv).padStart(5,'0')}-${String(num).padStart(8,'0')}`;

      // Fila header (amarillo)
      const fechaEsteCliente = getFechaCliente(idControl);
      const headerRow = [
        Number(idControl), cliente.nombre_xubio || cliente.nombre_display, 1, numFmt,
        fmtFecha(fechaEsteCliente), fmtFecha(addDays(fechaEsteCliente, 5)),
        undefined, 'Pesos Argentinos', undefined, lotesParaCliente(idControl, (fechasCliente as Record<string,string>)[idControl] || fechaBase),
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined
      ];
      headerRows.push(rows.length);
      rows.push(headerRow);

      const obsCliente = cliente.nombre_xubio || cliente.nombre_display;
      // Filas de productos (paquetes)
      for (const linea of lineas) {
        for (const prod of PRODS) {
          const qty = Number((linea as any)[prod.key]) || 0;
          if (qty <= 0) continue;
          const precio = getPrecio(precios, idControl, linea.sucursal, prod.key, cliente.sucursales);
          const importe = qty * precio;
          const iva = esA ? Math.round(importe * 0.105 * 100) / 100 : 0;
          rows.push([
            Number(idControl), undefined, undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, undefined,
            prod.xubio, undefined, linea.sucursal || obsCliente,
            qty, precio, 0, importe, iva
          ]);
        }
        // Filas de productos KG (clientes que facturan por cajón, ej. Select Food)
        for (const prod of PRODS_KG) {
          const qty = Number((linea as any)[prod.key]) || 0;
          if (qty <= 0) continue;
          const precio = getPrecio(precios, idControl, linea.sucursal, prod.key, cliente.sucursales);
          const importe = qty * precio;
          const iva = esA ? Math.round(importe * 0.105 * 100) / 100 : 0;
          rows.push([
            Number(idControl), undefined, undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, undefined,
            prod.xubio, undefined, linea.sucursal || obsCliente,
            qty, precio, 0, importe, iva
          ]);
        }
      }
    }

    // Crear worksheet
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Estilo amarillo en header rows (xlsx básico, sin estilos ricos en xlsxjs sin pro)
    // Escribimos las posiciones para referencia manual si se abre en Excel
    XLSX.utils.book_append_sheet(wb, ws, 'Facturacion');
    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }); // formato .xls nativo

    // Guardar correlativo solo si se usó (cambió respecto al inicial)
    const cfgA = config.find(c => c.clave === 'last_factura_a');
    const cfgB = config.find(c => c.clave === 'last_factura_b');
    if (cfgA && lastA > initialA) await updateRow('Config', 'clave', 'last_factura_a', { valor: lastA });
    if (cfgB && lastB > initialB) await updateRow('Config', 'clave', 'last_factura_b', { valor: lastB });

    // Marcar filas con el ID de exportación (conserva valores para historial)
    const resetFecha = new Date().toISOString().split('T')[0];
    await batchUpdateRows('Ventas', 'id_venta', ventasFecha.map(v => ({
      keyValue: v.id_venta,
      updates: { exportado: id_exportacion, fecha_carga: resetFecha },
    })));

    // Abreviaturas de clientes para filename y subject
    const fechaLimpia = fecha.replace(/-/g, '');
    const abrevs = clientesFacturados.map(abreviarCliente).filter(Boolean);
    const clientesFilename = abrevs.map(a => a.replace(/ /g, '')).slice(0, 6).join('-')
      + (abrevs.length > 6 ? `-mas${abrevs.length - 6}` : '');
    const nombreArchivo = `xavia_xubio_${fechaLimpia}${clientesFilename ? '_' + clientesFilename : ''}.xls`;
    const clientesSubject = abrevs.slice(0, 8).join(', ')
      + (abrevs.length > 8 ? ` +${abrevs.length - 8}` : '');

    // Enviar email via Resend (sin SMTP, sin dependencias)
    let emailOk = false;
    let emailError = '';
    if (enviarEmail && process.env.RESEND_API_KEY) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Xavia App <ventas@xavia.com.ar>',
            to: ['administracion@xavia.com.ar'],
            subject: `Ventas Xavia — ${fecha}${clientesSubject ? ' — ' + clientesSubject : ''} (${facturasGeneradas} facturas)`,
            html: `<p>Se adjunta archivo de ventas del <strong>${fecha}</strong>.<br>Clientes: <strong>${clientesFacturados.join(', ')}</strong><br>Facturas: <strong>${facturasGeneradas}</strong> · A hasta <strong>${lastA}</strong> · B hasta <strong>${lastB}</strong></p>`,
            attachments: [{
              filename: nombreArchivo,
              content: Buffer.from(xlsxBuf).toString('base64'),
            }],
          }),
        });
        if (res.ok) {
          emailOk = true;
        } else {
          const errBody = await res.json().catch(() => ({}));
          emailError = (errBody as any).message || `HTTP ${res.status}`;
        }
      } catch (emailErr: any) {
        emailError = emailErr.message || 'Error desconocido';
      }
    } else if (enviarEmail && !process.env.RESEND_API_KEY) {
      emailError = 'RESEND_API_KEY no configurada en Vercel';
    }

    return NextResponse.json({
      ok: true, emailOk, emailError,
      facturas: facturasGeneradas,
      lastA, lastB, id_exportacion,
      filename: nombreArchivo,
      file: Buffer.from(xlsxBuf).toString('base64'),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
