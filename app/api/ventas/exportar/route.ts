import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { ClienteVenta, PrecioVenta, VentaDia, ConfigItem, Lote } from '@/lib/types';
import * as XLSX from 'xlsx';
import nodemailer from 'nodemailer';

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

function getPrecio(precios: PrecioVenta[], id_control: string, sucursal: string, key: string): number {
  const row = precios.find(p => String(p.id_control) === String(id_control) && p.sucursal_obs === sucursal);
  if (!row) return 0;
  return Number((row as any)[key] || 0);
}

function fmtFecha(d: Date) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });

  try {
    const { fecha, fechaFactura, fechasCliente = {}, correlaA, correlaB, enviarEmail = true } = await req.json();
    const fechaBase = fechaFactura || fecha;
    const [clientes, precios, ventas, config, lotes] = await Promise.all([
      readSheet<ClienteVenta>('Clientes'),
      readSheet<PrecioVenta>('Precios'),
      readSheet<VentaDia>('Ventas'),
      readSheet<ConfigItem>('Config'),
      readSheet<Lote>('Lotes'),
    ]);

    const ventasFecha = ventas.filter(v => v.fecha === fecha);
    if (!ventasFecha.length) return NextResponse.json({ error: 'Sin ventas para esa fecha' }, { status: 400 });

    // Usar correlativo manual si se provee, sino leer de Config
    let lastA = correlaA !== undefined ? Number(correlaA) - 1 : Number(config.find(c => c.clave === 'last_factura_a')?.valor || 665);
    let lastB = correlaB !== undefined ? Number(correlaB) - 1 : Number(config.find(c => c.clave === 'last_factura_b')?.valor || 575);

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

      // Verificar si hay alguna cantidad > 0
      const tieneVentas = lineas.some(l =>
        ['rucula','lechuga_crespa','hoja_roble','bandeja_rucula','albahaca']
          .some(k => Number((l as any)[k]) > 0)
      );
      if (!tieneVentas) continue;

      const esA = cliente.tipo_factura === 'A';
      const pv = Number(cliente.punto_venta);
      const num = esA ? ++lastA : ++lastB;
      const numFmt = `${cliente.tipo_factura}-${String(pv).padStart(5,'0')}-${String(num).padStart(8,'0')}`;

      // Fila header (amarillo)
      const fechaEsteCliente = getFechaCliente(idControl);
      const headerRow = [
        Number(idControl), cliente.nombre_xubio, 1, numFmt,
        fmtFecha(fechaEsteCliente), fmtFecha(addDays(fechaEsteCliente, 5)),
        '', 'Pesos Argentinos', '', lotesParaCliente(idControl, (fechasCliente as Record<string,string>)[idControl] || fechaBase),
        '', '', '', '', '', '', '', ''
      ];
      headerRows.push(rows.length);
      rows.push(headerRow);

      // Filas de productos
      for (const linea of lineas) {
        for (const prod of PRODS) {
          const qty = Number((linea as any)[prod.key] || 0);
          if (qty <= 0) continue;
          const precio = getPrecio(precios, idControl, linea.sucursal || cliente.nombre_xubio, prod.key);
          const importe = qty * precio;
          const iva = esA ? Math.round(importe * 0.105 * 100) / 100 : 0;
          rows.push([
            '', '', '', '', '', '', '', '', '', '',
            prod.xubio, '', linea.sucursal || cliente.nombre_xubio,
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
    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Guardar correlativo actualizado
    const cfgA = config.find(c => c.clave === 'last_factura_a');
    const cfgB = config.find(c => c.clave === 'last_factura_b');
    if (cfgA) await updateRow('Config', 'clave', 'last_factura_a', { valor: lastA });
    if (cfgB) await updateRow('Config', 'clave', 'last_factura_b', { valor: lastB });

    // Marcar ventas como exportadas
    for (const v of ventasFecha) {
      await updateRow('Ventas', 'id_venta', v.id_venta, { exportado: 'SI', fecha_carga: new Date().toISOString().split('T')[0] });
    }

    // Enviar email solo si se pide
    let emailOk = false;
    let emailError = '';
    if (enviarEmail && process.env.SMTP_USER) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: Number(process.env.SMTP_PORT || 587),
          secure: false,
          requireTLS: true,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          tls: { rejectUnauthorized: false },
        });
        const nombreArchivo = `xavia_xubio_${fecha}.xlsx`;
        await transporter.sendMail({
          from: `"Xavia App" <${process.env.SMTP_USER}>`,
          to: 'administracion@xavia.com.ar',
          subject: `Ventas Xavia — ${fecha} (${controlesUsados.length} facturas)`,
          html: `<p>Se adjunta archivo de ventas del <strong>${fecha}</strong>.<br>Facturas: <strong>${controlesUsados.length}</strong> · A hasta <strong>${lastA}</strong> · B hasta <strong>${lastB}</strong></p>`,
          attachments: [{ filename: nombreArchivo, content: xlsxBuf }],
        });
        emailOk = true;
      } catch (emailErr: any) {
        emailError = emailErr.message || 'Error desconocido';
        console.warn('Email no enviado:', emailError);
      }
    }

    return NextResponse.json({
      ok: true, emailOk, emailError,
      facturas: controlesUsados.length,
      lastA, lastB,
      filename: `xavia_xubio_${fecha}.xlsx`,
      file: Buffer.from(xlsxBuf).toString('base64'),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
