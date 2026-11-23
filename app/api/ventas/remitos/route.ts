import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia, ClienteVenta } from '@/lib/types';
import { ARTICULOS } from '@/lib/articulos';
import { leerArticulosExtra } from '@/lib/articulosVenta';
import { remitosDeFacturas, totalDe, type ArticuloRemito, type Remito } from '@/lib/remitos';
import { remitoPdf, nombreArchivo } from '@/lib/remitoPdf';
import { claveComprobante } from '@/lib/comprobantes';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ── Remitos de lo ya facturado ───────────────────────────────────────────────────────
//
// GET  = las facturas de los últimos días, con su remito armado. No manda nada.
// POST = genera los PDF y se los manda por mail a cada cliente.
//
// El remito sale DESPUÉS de facturar, así que la fuente es la factura emitida: lo que dice
// el remito es exactamente lo que se facturó (ver lib/remitos.ts).

const DIAS_DEFECTO = 7;
const DIAS_MAX = 30;

async function catalogo(): Promise<ArticuloRemito[]> {
  const extras = await leerArticulosExtra().catch(() => []);
  // Los del código y los dados de alta desde Admin. Si acá fuera solo la lista del código,
  // un artículo nuevo saldría con cantidad cero en el remito y la entrega quedaría
  // documentada de menos.
  return [...ARTICULOS, ...extras.filter((e) => !ARTICULOS.some((a) => a.key === e.key))]
    .map((a) => ({ key: a.key, label: a.label, unidad: a.unidad === 'kg' ? 'kg' : 'u' }));
}

async function armar(dias: number): Promise<Remito[]> {
  const [ventas, clientes, arts] = await Promise.all([
    readSheet<VentaDia>('Ventas'),
    readSheet<ClienteVenta>('Clientes'),
    catalogo(),
  ]);
  return remitosDeFacturas({ ventas, clientes, articulos: arts, hoy: fechaArgentinaHoy(), dias });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'solo_admin' }, { status: 403 });

  const url = new URL(req.url);
  const dias = Math.min(DIAS_MAX, Math.max(1, Number(url.searchParams.get('dias')) || DIAS_DEFECTO));

  try {
    const remitos = await armar(dias);

    // Un remito puntual, para poder mirarlo antes de mandarlo. Se descarga, no se manda.
    const uno = String(url.searchParams.get('numero') || '').trim();
    if (uno) {
      const r = remitos.find((x) => claveComprobante(x.numeroFactura) === claveComprobante(uno));
      if (!r) return NextResponse.json({ error: `No se encontró la factura ${uno} en los últimos ${dias} días.` }, { status: 404 });
      const pdf = await remitoPdf(r);
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${nombreArchivo(r)}"`,
        },
      });
    }

    return NextResponse.json({
      ok: true, dias,
      remitos: remitos.map((r) => ({
        numeroFactura: r.numeroFactura,
        fecha: r.fecha,
        cliente: r.cliente,
        sucursales: r.porSucursal.map((s) => s.sucursal),
        renglones: r.porSucursal.reduce((a, s) => a + s.lineas.length, 0),
        total: totalDe(r),
        email: r.email,
        emailDe: r.emailDe,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  if (user.rol !== 'admin') return NextResponse.json({ error: 'solo_admin' }, { status: 403 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'RESEND_API_KEY no configurada' }, { status: 500 });

  try {
    const { numeros, dias } = await req.json();
    const pedidos: string[] = Array.isArray(numeros) ? numeros.map((n: any) => String(n)) : [];
    if (!pedidos.length) return NextResponse.json({ error: 'No elegiste ninguna factura.' }, { status: 400 });

    const todos = await armar(Math.min(DIAS_MAX, Math.max(1, Number(dias) || DIAS_DEFECTO)));
    const claves = new Set(pedidos.map((n) => claveComprobante(n)));
    const aMandar = todos.filter((r) => claves.has(claveComprobante(r.numeroFactura)));

    const enviados: { numero: string; cliente: string; email: string }[] = [];
    const fallados: { numero: string; cliente: string; error: string }[] = [];

    for (const r of aMandar) {
      // Sin dirección no se manda y se dice cuál: un "se enviaron 6 de 8" sin nombres deja
      // a alguien revisando ocho clientes para encontrar los dos que faltaron.
      if (!r.email) {
        fallados.push({ numero: r.numeroFactura, cliente: r.cliente, error: 'el cliente no tiene mail cargado (ni general ni de cobranzas)' });
        continue;
      }
      try {
        const pdf = await remitoPdf(r);
        const t = totalDe(r);
        const detalle = r.porSucursal.map((s) => {
          const items = s.lineas.map((l) => `${l.cantidad} ${l.unidad === 'kg' ? 'kg' : 'u'} de ${l.articulo}`).join(', ');
          return s.sucursal && s.sucursal !== r.cliente ? `<li><strong>${s.sucursal}</strong>: ${items}</li>` : `<li>${items}</li>`;
        }).join('');

        const html = `
          <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:600px">
            <p style="margin:0 0 12px">Hola,</p>
            <p style="margin:0 0 12px">
              Va adjunto el remito de la entrega del <strong>${r.fecha.split('-').reverse().join('/')}</strong>,
              correspondiente a la factura <strong>${r.numeroFactura}</strong>.
            </p>
            <ul style="margin:0 0 12px;padding-left:18px;color:#374151;font-size:14px">${detalle}</ul>
            <p style="margin:0 0 12px;color:#374151;font-size:14px">
              Total entregado: ${[t.unidades > 0 ? `${t.unidades} unidades` : '', t.kilos > 0 ? `${t.kilos} kg` : ''].filter(Boolean).join(' + ')}.
            </p>
            <p style="margin:0 0 4px;color:#6b7280;font-size:13px">Cualquier diferencia, avisanos y lo revisamos.</p>
            <p style="margin:16px 0 0;color:#6b7280;font-size:13px">Xavia</p>
          </div>`;

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Xavia <ventas@xavia.com.ar>',
            to: [r.email],
            subject: `Remito de la entrega del ${r.fecha.split('-').reverse().join('/')} — factura ${r.numeroFactura}`,
            html,
            attachments: [{ filename: nombreArchivo(r), content: Buffer.from(pdf).toString('base64') }],
          }),
        });
        if (!res.ok) {
          const err = await res.text().catch(() => '');
          throw new Error(`Resend ${res.status}: ${err.slice(0, 150)}`);
        }
        enviados.push({ numero: r.numeroFactura, cliente: r.cliente, email: r.email });
      } catch (e: any) {
        fallados.push({ numero: r.numeroFactura, cliente: r.cliente, error: e?.message || 'no se pudo enviar' });
      }
    }

    // Las pedidas que no se encontraron: son facturas fuera de la ventana o sin ventas
    // cargadas detrás. Decirlo evita que se cuenten como enviadas por omisión.
    const noEncontradas = pedidos.filter((n) => !aMandar.some((r) => claveComprobante(r.numeroFactura) === claveComprobante(n)));

    return NextResponse.json({ ok: true, enviados, fallados, noEncontradas });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 });
  }
}
