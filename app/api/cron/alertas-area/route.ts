import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { Lote, Articulo, StockMes, ClienteVenta, PrecioVenta, VentaDia, ConfigItem, Gasto, CajonMovimiento } from '@/lib/types';
import { generarAlertas, alertasStockBajo } from '@/lib/alertasPanel';
import { leerDescartes, sinDescartadas } from '@/lib/alertasDescartadas';
import { calcularDriversMes } from '@/lib/usoTeorico';
import { saldoPorCliente, alertasCajones } from '@/lib/cajones';
import { deudaProveedores } from '@/lib/proveedores';
import { destinatariosDe } from '@/lib/avisosConfig';
import { AREAS, porArea, htmlDeArea, type AlertaArea } from '@/lib/areasAlertas';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASE = 'https://xavia-self.vercel.app';

// ── Un mail por área, solo con lo de esa área ────────────────────────────────────────
//
// El reporte semanal completo sigue yendo entero a administración: es la mirada de
// conjunto. Esto es lo otro — lo accionable, al que tiene que hacer algo.
//
// Lo que YA tiene su propio mail no se repite acá (clientes que dejaron de pedir, ventas
// sin facturar). Mandar la misma alerta por dos canales el mismo día enseña a ignorar los
// dos.
//
// Los generadores son los mismos que usa el Panel, importados: si acá se recalcularan con
// otro criterio, el mail y la pantalla dirían cosas distintas sobre el mismo día.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // `probar` manda todo a quien lo pide en vez de a los responsables: sirve para ver cómo
  // queda el mail sin escribirle a cuatro personas.
  const soloVer = new URL(req.url).searchParams.get('ver') === '1';

  try {
    const [lotes, articulos, stocks, clientes, precios, ventas, config, gastos, movCajones, tubosMesadas] = await Promise.all([
      readSheet<Lote>('Lotes').catch(() => [] as Lote[]),
      readSheet<Articulo>('Articulos').catch(() => [] as Articulo[]),
      readSheet<StockMes>('StockMensual').catch(() => [] as StockMes[]),
      readSheet<ClienteVenta>('Clientes').catch(() => [] as ClienteVenta[]),
      readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
      readSheet<VentaDia>('Ventas').catch(() => [] as VentaDia[]),
      readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]),
      readSheet<Gasto>('Gastos').catch(() => [] as Gasto[]),
      readSheet<CajonMovimiento>('CajonesMovimientos').catch(() => [] as CajonMovimiento[]),
      readSheet<any>('TubosMesadas').catch(() => [] as any[]),
    ]);

    const hoy = new Date();
    const hoyISO = fechaArgentinaHoy();
    const todas: AlertaArea[] = [];

    // ── Producción ──
    try {
      for (const a of generarAlertas(lotes, tubosMesadas, new Map(), 0)) {
        // Los atrasos puntuales de un lote no van por mail: son decenas y ya se ven en el
        // Panel con su color por tiempo. Lo que va es lo que no se mira solo.
        if (a.categoria === 'lote_atraso') continue;
        todas.push({ area: 'produccion', tipo: a.tipo, msg: a.msg, href: a.href || '/panel' });
      }
    } catch { /* un área que falla no puede tumbar las otras tres */ }

    // ── Stocks ──
    try {
      let mesPrev = hoy.getMonth(), anioPrev = hoy.getFullYear();
      if (mesPrev === 0) { mesPrev = 12; anioPrev--; }
      const diasMesPrev = new Date(anioPrev, mesPrev, 0).getDate();
      const dAct = calcularDriversMes(lotes, ventas, precios, clientes, hoy.getFullYear(), hoy.getMonth() + 1);
      const dAnt = calcularDriversMes(lotes, ventas, precios, clientes, anioPrev, mesPrev);
      const alertasStock = alertasStockBajo(articulos, stocks, dAct, dAnt, hoy.getFullYear(), hoy.getMonth() + 1, diasMesPrev, 15);
      // Las descartadas a mano en el Panel no vuelven por mail: descartar una alerta y que
      // igual te llegue al correo es la mejor forma de que nadie descarte ninguna.
      const descartes = await leerDescartes();
      for (const a of sinDescartadas(alertasStock, descartes, hoy.getFullYear(), hoy.getMonth() + 1)) {
        todas.push({ area: 'stocks', tipo: a.tipo, msg: a.msg, href: a.href || '/stocks' });
      }
    } catch { /* idem */ }

    // ── Ventas ──
    try {
      for (const c of alertasCajones(saldoPorCliente(movCajones, clientes, hoy), 7)) {
        todas.push({
          area: 'ventas',
          tipo: (c.diasSinMovimiento || 0) > 21 ? 'error' : 'warn',
          msg: `${c.nombre} debe ${c.saldo} ${c.saldo === 1 ? 'cajón' : 'cajones'} — sin movimiento hace ${c.diasSinMovimiento} días`,
          href: '/cajones',
        });
      }
    } catch { /* idem */ }

    // ── Plata ──
    try {
      for (const d of deudaProveedores(gastos, hoyISO)) {
        if (d.vencido <= 0) continue;
        const vencidas = d.items.filter((i) => i.diasParaVencer !== null && i.diasParaVencer < 0);
        const masVieja = vencidas.reduce((m, i) => Math.min(m, i.diasParaVencer ?? 0), 0);
        todas.push({
          area: 'plata',
          tipo: Math.abs(masVieja) > 15 ? 'error' : 'warn',
          msg: `${d.proveedor}: $${Math.round(d.vencido).toLocaleString('es-AR')} vencido en ${vencidas.length} compra(s)`
            + (masVieja < 0 ? ` — la más vieja venció hace ${Math.abs(masVieja)} días` : ''),
          href: '/gastos',
        });
      }
    } catch { /* idem */ }

    const agrupadas = porArea(todas);
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada', porArea: Object.fromEntries([...agrupadas].map(([k, v]) => [k, v.length])) }, { status: 500 });
    }

    const enviados: { area: string; destinatarios: string[]; alertas: number }[] = [];
    const omitidos: { area: string; motivo: string }[] = [];

    for (const cfg of AREAS) {
      const lista = agrupadas.get(cfg.area) || [];
      // Sin alertas no se manda nada. Ver la nota al pie del mail: el silencio es la señal
      // de que no hay nada, y vale más que un "sin novedades" diario.
      if (!lista.length) { omitidos.push({ area: cfg.area, motivo: 'sin alertas' }); continue; }
      const destinatarios = destinatariosDe(cfg.clave, config);
      if (!destinatarios.length) { omitidos.push({ area: cfg.area, motivo: 'sin destinatarios configurados' }); continue; }

      if (soloVer) { enviados.push({ area: cfg.area, destinatarios: ['(modo ver, no se mandó)'], alertas: lista.length }); continue; }

      const urgentes = lista.filter((a) => a.tipo === 'error').length;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Xavia App <ventas@xavia.com.ar>',
          to: destinatarios,
          subject: `${cfg.titulo}: ${lista.length} ${lista.length === 1 ? 'alerta' : 'alertas'}${urgentes > 0 ? ` (${urgentes} para hoy)` : ''} — Xavia`,
          html: htmlDeArea(cfg, lista, BASE),
        }),
      });
      // Se mira la respuesta: un mail que Resend rechaza y nadie chequea es peor que no
      // tener aviso, porque se confía en algo que nunca llega.
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        omitidos.push({ area: cfg.area, motivo: `Resend ${res.status}: ${err.slice(0, 120)}` });
        continue;
      }
      enviados.push({ area: cfg.area, destinatarios, alertas: lista.length });
    }

    return NextResponse.json({ ok: true, hoy: hoyISO, enviados, omitidos });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'server_error' }, { status: 500 });
  }
}
