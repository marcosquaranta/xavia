import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import type { VentaDia, PrecioVenta, ClienteVenta, ConfigItem, Lote } from '@/lib/types';
import { ARTICULOS, PROD_KEYS } from '@/lib/articulos';
import { clientesPrecioVsVolumen } from '@/lib/estadisticasVentas';
import { evolucionPrecioPromedio } from '@/lib/estadisticasVentas';
import { HOJA_PRECIOS_HIST, CAMPOS_PRECIO, type CambioPrecio } from '@/lib/preciosHistorico';
import { armarReporte, atrasados, pctPonderado, type FilaReportePrecios } from '@/lib/reportePrecios';
import { destinatariosDe } from '@/lib/avisosConfig';
import { fechaArgentinaHoy } from '@/lib/ocupacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ── El reporte de precios, una vez por mes ───────────────────────────────────────────
//
// Para qué existe: decidir a quién aumentarle. Esa decisión necesita dos números al lado —
// cuánto compra el cliente y hace cuánto que no se le sube— y estaban en pantallas
// distintas. Un cliente grande con ocho meses sin aumento es un problema caro; uno chico al
// que se le subió el mes pasado no es ninguno.
//
// Va el día 20 porque es cuando todavía se puede avisar un aumento para el mes que viene.
// El 1 sería tarde y el 10 cae en medio del cierre del mes anterior.
//
// Corre todos los días y chequea el día acá adentro, no en el cron de Vercel: una sola
// corrida mensual que falle por un timeout de Sheets dejaría el mes sin reporte, y nadie se
// enteraría hasta el mes siguiente. Se manda una sola vez por mes porque se anota la última
// corrida en la hoja de configuración.
const CLAVE_CONFIG = 'email_reporte_precios';
const CLAVE_ULTIMO = 'reporte_precios_ultimo_mes';
const DIA_DEL_MES = 20;
// ── Hasta cuándo se puede mandar ────────────────────────────────────────────────────
//
// El cron corre todos los días y manda solo si todavía no se mandó este mes. Eso depende
// de que el "ya se mandó" quede guardado: si esa escritura falla, el aviso sale TODOS los
// días del 20 en adelante. Fue lo que pasó.
//
// Esta ventana es el cinturón además de los tirantes. Aunque el flag no se guarde nunca,
// el reporte puede repetirse a lo sumo cuatro veces y no once. Y como el fallo ahora se
// informa (ver `guardado` más abajo), se puede arreglar en vez de descubrirlo por el
// cuarto mail.
const DIA_LIMITE = 23;
// Qué ventana se mira para el volumen. 60 días y no 30: con 30, un cliente que esa semana
// no pidió aparece como chico y queda al final de una lista que se ordena justamente por
// eso.
const DIAS_VOLUMEN = 60;
// A partir de cuántos días sin aumento un cliente se destaca arriba. No es una ley: es
// dónde cortar la lista para que el mail empiece por algo y no por todo.
const DIAS_ATRASO = 90;
const URL_CLIENTES = 'https://xavia-self.vercel.app/admin/clientes-venta';

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const fmtDia = (f: string) => { const [y, m, d] = String(f || '').split('-'); return d ? `${d}/${m}/${y}` : ''; };
const LABEL = new Map(ARTICULOS.map((a) => [a.key, a.label]));
const label = (k: string) => LABEL.get(k) || k.replace(/_/g, ' ');

function mesDe(hoy: string): string { return hoy.slice(0, 7); }

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  if (!esCron && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  // `ver=1` muestra qué saldría, sin mandar nada y sin anotar el mes. Es lo que permite
  // mirarlo cualquier día sin gastar la corrida del mes.
  const soloVer = url.searchParams.get('ver') === '1';
  // `forzar=si` lo manda aunque no sea 20 ni corresponda. Manual: el cron nunca lo pasa.
  const forzar = url.searchParams.get('forzar') === 'si';

  const hoy = fechaArgentinaHoy();
  const dia = Number(hoy.slice(8, 10));

  try {
    const [ventas, precios, clientes, lotes, config] = await Promise.all([
      readSheet<VentaDia>('Ventas'),
      readSheet<PrecioVenta>('Precios').catch(() => [] as PrecioVenta[]),
      readSheet<ClienteVenta>('Clientes'),
      readSheet<Lote>('Lotes').catch(() => [] as Lote[]),
      readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]),
    ]);

    const mes = mesDe(hoy);
    const yaMandado = String(config.find((c) => String(c.clave).trim() === CLAVE_ULTIMO)?.valor || '').trim();
    if (!soloVer && !forzar) {
      if (dia < DIA_DEL_MES) {
        return NextResponse.json({ ok: true, enviado: false, hoy, motivo: `es el día ${dia}: se manda el ${DIA_DEL_MES}` });
      }
      if (dia > DIA_LIMITE) {
        return NextResponse.json({ ok: true, enviado: false, hoy,
          motivo: `es el día ${dia}: la ventana para mandarlo va del ${DIA_DEL_MES} al ${DIA_LIMITE}`,
          ultimoMesGuardado: yaMandado || '(nada guardado)' });
      }
      if (yaMandado === mes) {
        return NextResponse.json({ ok: true, enviado: false, hoy, motivo: `el reporte de ${mes} ya se mandó` });
      }
    }

    // ── El volumen, calculado donde se calcula para todo lo demás ────────────────────
    //
    // Misma función que usa la pantalla de estadísticas. Si acá se contara distinto, el mail
    // y la pantalla ordenarían los mismos clientes en distinto orden, y el que compara las
    // dos no sabe a cuál creerle.
    const vol = clientesPrecioVsVolumen(ventas, precios, clientes, lotes, new Date(hoy + 'T12:00:00'), DIAS_VOLUMEN);

    // Cuánto compró cada cliente de cada producto, para poder ponderar el porcentaje por lo
    // que de verdad lleva. El promedio simple le daría el mismo peso a la albahaca de una
    // vez al mes que a la rúcula de todos los días.
    const desde = (() => { const d = new Date(hoy + 'T12:00:00'); d.setDate(d.getDate() - (DIAS_VOLUMEN - 1)); return d.toISOString().slice(0, 10); })();
    const volPorProducto = new Map<string, Map<string, number>>();
    for (const v of ventas) {
      const f = String(v.fecha || '').split(/[T ]/)[0];
      if (!f || f < desde || f > hoy) continue;
      const id = String(v.id_control || '');
      if (!id) continue;
      const m = volPorProducto.get(id) || new Map<string, number>();
      for (const k of PROD_KEYS) {
        const q = Number((v as any)[k]) || 0;
        if (q > 0) m.set(k, (m.get(k) || 0) + q);
      }
      volPorProducto.set(id, m);
    }

    // Los precios de hoy, por cliente. Se toma la primera ficha del cliente: desde hace poco
    // el precio es uno solo para todas las sucursales (decisión de Marcos), así que listar
    // una por sucursal serían N copias de la misma lista.
    const preciosHoy = new Map<string, { producto: string; precio: number }[]>();
    for (const p of precios) {
      const id = String(p.id_control || '').trim();
      if (!id || preciosHoy.has(id)) continue;
      const lista = CAMPOS_PRECIO
        .map((c) => ({ producto: c as string, precio: Number((p as any)[c]) || 0 }))
        .filter((x) => x.precio > 0);
      if (lista.length) preciosHoy.set(id, lista);
    }

    const historial = await readSheet<CambioPrecio>(HOJA_PRECIOS_HIST).catch(() => [] as CambioPrecio[]);
    // La evolución del precio promedio, la misma función que dibuja la pantalla de Ventas.
    const evolPrecio = evolucionPrecioPromedio(ventas, precios, clientes, 12, lotes);

    const filas = armarReporte({
      hoy,
      volumen: vol.map((v) => ({ id_control: v.id_control, nombre: v.nombre, monto: v.monto, unidades: v.unidades })),
      volumenPorProducto: volPorProducto,
      historial,
      preciosHoy,
    });

    // Los clientes con los que no se vendió nada en la ventana no entran: el reporte es para
    // decidir aumentos, y a quien no te compra no le estás cobrando ningún precio.
    const activos = filas.filter((f) => f.monto > 0);
    const atrasadosL = atrasados(activos, DIAS_ATRASO);

    if (soloVer) {
      return NextResponse.json({
        hoy, mes, dia,
        // Lo primero que hay que mirar si el reporte llega más de una vez: si esto no es
        // el mes en curso, la marca no se guardó y por eso se repite.
        ultimo_mes_guardado: yaMandado || '(nada guardado)',
        se_repetiria: dia >= DIA_DEL_MES && dia <= DIA_LIMITE && yaMandado !== mes,
        ventana: `del ${DIA_DEL_MES} al ${DIA_LIMITE}`,
        clientes: activos.length,
        atrasados: atrasadosL.length,
        filas: activos.map((f) => ({
          nombre: f.nombre, monto: f.monto,
          ultimaSuba: f.ultimaSuba && {
            fecha: f.ultimaSuba.fecha, dias: f.ultimaSuba.diasDesde,
            pct: f.ultimaSuba.pctPromedio, impacto: f.ultimaSuba.impactoMensual,
          },
        })),
      });
    }

    if (!activos.length) return NextResponse.json({ ok: true, enviado: false, hoy, motivo: 'no hay clientes con ventas en la ventana' });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no configurada' }, { status: 500 });

    const destinatarios = destinatariosDe(CLAVE_CONFIG, config);
    if (!destinatarios.length) return NextResponse.json({ ok: false, error: `${CLAVE_CONFIG} no tiene ningún mail válido` }, { status: 500 });

    const impactoTotal = activos.reduce((a, f) => a + (f.ultimaSuba?.impactoMensual || 0), 0);
    const sinRegistro = activos.filter((f) => !f.ultimaSuba).length;

    const filaHtml = (f: FilaReportePrecios) => {
      const s = f.ultimaSuba;
      const viejo = !s || s.diasDesde >= DIAS_ATRASO;
      const detalle = s
        ? s.productos.map((p) => `${label(p.producto)} ${fmt$(p.anterior)}→${fmt$(p.nuevo)} (${p.variacionPct > 0 ? '+' : ''}${p.variacionPct}%)`).join(' · ')
        : '';
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top">
          <strong>${f.nombre}</strong><br>
          <span style="color:#9ca3af;font-size:11.5px">${fmt$(f.monto)} en ${DIAS_VOLUMEN} días</span>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;white-space:nowrap;color:${viejo ? '#b91c1c' : '#374151'};font-weight:${viejo ? 800 : 600}">
          ${s ? `${fmtDia(s.fecha)}<br><span style="font-weight:400;font-size:11.5px">hace ${s.diasDesde} días</span>` : 'sin registro'}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;text-align:right;white-space:nowrap">
          ${s ? `<strong style="color:#166534">${s.pctPromedio > 0 ? '+' : ''}${s.pctPromedio}%</strong><br>
                 <span style="font-size:11.5px;color:#6b7280">${s.impactoMensual > 0 ? `+${fmt$(s.impactoMensual)}/mes` : ''}</span>` : '—'}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;font-size:11.5px;color:#6b7280">
          ${detalle || '—'}
        </td>
      </tr>`;
    };

    // ── Los dos gráficos, dibujados con tablas ─────────────────────────────────────
    //
    // En un mail no hay JavaScript, y Gmail borra el SVG: los gráficos de la pantalla no se
    // pueden pegar acá. Se redibujan con celdas de colores, que es lo único que todos los
    // clientes de correo muestran igual.
    //
    // No es una limitación que se sufra: lo que se quiere ver en estos dos es la FORMA
    // —quién paga poco llevándose mucho, y si el precio promedio viene subiendo o
    // aplanándose—, y una barra la muestra igual que un punto.
    const barra = (pct: number, color: string, alto = 9) => `
      <div style="background:#f1f1f1;border-radius:${alto}px;height:${alto}px;width:100%">
        <div style="background:${color};border-radius:${alto}px;height:${alto}px;width:${Math.max(1, Math.min(100, Math.round(pct)))}%"></div>
      </div>`;

    // ── Precio vs. volumen ──
    //
    // El gráfico de la pantalla es una nube de puntos. Acá va como tabla ordenada por
    // volumen, con las dos barras al lado: el que tiene la barra de volumen larga y la de
    // precio corta es el que hay que mirar, que es exactamente lo que se busca en la nube.
    const maxVol = Math.max(1, ...activos.map((f) => f.unidades));
    const maxPre = Math.max(1, ...vol.map((v) => v.precioPromedio));
    const filasVol = activos.slice(0, 20).map((f) => {
      const v = vol.find((x) => String(x.id_control) === String(f.id_control));
      const precio = v?.precioPromedio || 0;
      const barato = precio > 0 && precio < maxPre * 0.85;
      return `<tr>
        <td style="padding:5px 8px;border-bottom:1px solid #f5f5f5;font-size:12px;white-space:nowrap">${f.nombre}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f5f5f5;width:34%">
          ${barra((f.unidades / maxVol) * 100, '#1d4ed8')}
          <span style="font-size:10.5px;color:#9ca3af">${f.unidades.toLocaleString('es-AR')} u</span>
        </td>
        <td style="padding:5px 8px;border-bottom:1px solid #f5f5f5;width:34%">
          ${barra((precio / maxPre) * 100, barato ? '#b45309' : '#059669')}
          <span style="font-size:10.5px;color:${barato ? '#b45309' : '#9ca3af'}">$${Math.round(precio).toLocaleString('es-AR')}/u${barato ? ' · por debajo' : ''}</span>
        </td>
      </tr>`;
    }).join('');

    // ── Evolución del precio promedio ──
    //
    // Doce meses, una columna por mes y por cultivo. El alto es relativo al mes más caro:
    // lo que importa es si viene subiendo o se aplanó, no el valor absoluto, que ya está
    // escrito debajo de cada columna.
    const maxEvo = Math.max(1, ...evolPrecio.flatMap((p2) => [p2.precioRucula, p2.precioLechuga]));
    const colsEvo = evolPrecio.map((p2) => {
      const col = (valor: number, color: string) => {
        const alto = Math.max(2, Math.round((valor / maxEvo) * 80));
        return `<div title="$${Math.round(valor).toLocaleString('es-AR')}" style="display:inline-block;width:9px;height:${alto}px;background:${color};border-radius:2px 2px 0 0;margin:0 1px;vertical-align:bottom"></div>`;
      };
      return `<td style="padding:0 3px;text-align:center;vertical-align:bottom">
        <div style="height:84px;vertical-align:bottom">${col(p2.precioRucula, '#166534')}${col(p2.precioLechuga, '#84cc16')}</div>
        <div style="font-size:9px;color:#9ca3af;padding-top:3px;white-space:nowrap">${p2.label}</div>
      </td>`;
    }).join('');
    const ultimo = evolPrecio[evolPrecio.length - 1];
    const primero = evolPrecio[0];
    const subioR = primero?.precioRucula > 0 && ultimo?.precioRucula > 0
      ? Math.round(((ultimo.precioRucula - primero.precioRucula) / primero.precioRucula) * 100) : null;

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:760px">
        <h2 style="margin:0 0 4px">Precios por cliente — ${fmtDia(hoy)}</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
          ${activos.length} clientes con ventas en los últimos ${DIAS_VOLUMEN} días, <strong>del que más compra al que menos</strong>.
          El porcentaje es el del último aumento, ponderado por lo que cada uno lleva de cada producto —no el promedio
          simple, que le daría el mismo peso a la albahaca de una vez al mes que a la rúcula de todos los días—.
        </p>

        ${atrasadosL.length ? `
        <div style="margin:0 0 18px;padding:11px 13px;background:#fef2f2;border:1px solid #fecaca;border-radius:7px">
          <p style="margin:0 0 4px;font-size:13.5px;font-weight:800;color:#b91c1c">
            ${atrasadosL.length} ${atrasadosL.length === 1 ? 'cliente lleva' : 'clientes llevan'} más de ${DIAS_ATRASO} días sin aumento
          </p>
          <p style="margin:0;font-size:12.5px;color:#7f1d1d">
            ${atrasadosL.slice(0, 8).map((f) => `${f.nombre} (${f.ultimaSuba ? `${f.ultimaSuba.diasDesde} d` : 'sin registro'})`).join(' · ')}${atrasadosL.length > 8 ? ` y ${atrasadosL.length - 8} más` : ''}
          </p>
        </div>` : ''}

        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:6px 10px;text-align:left">Cliente</th>
            <th style="padding:6px 10px;text-align:left">Último aumento</th>
            <th style="padding:6px 10px;text-align:right">Cuánto</th>
            <th style="padding:6px 10px;text-align:left">Qué subió</th>
          </tr></thead>
          <tbody>${activos.map(filaHtml).join('')}</tbody>
        </table>

        <h3 style="margin:26px 0 6px;font-size:14px">Precio vs. volumen por cliente</h3>
        <p style="margin:0 0 8px;color:#6b7280;font-size:12.5px">
          Del que más lleva al que menos. El que tiene la barra azul larga y la verde corta es el que compra mucho y
          paga poco — ese es el que conviene mirar primero.
        </p>
        <table style="border-collapse:collapse;width:100%">
          <thead><tr style="background:#f9fafb;color:#6b7280;font-size:10.5px;text-transform:uppercase">
            <th style="padding:5px 8px;text-align:left">Cliente</th>
            <th style="padding:5px 8px;text-align:left">Volumen</th>
            <th style="padding:5px 8px;text-align:left">Precio por unidad</th>
          </tr></thead>
          <tbody>${filasVol}</tbody>
        </table>
        ${activos.length > 20 ? `<p style="margin:5px 0 0;font-size:11px;color:#9ca3af">Van los 20 de más volumen, de ${activos.length}.</p>` : ''}

        <h3 style="margin:26px 0 6px;font-size:14px">Evolución del precio promedio</h3>
        <p style="margin:0 0 10px;color:#6b7280;font-size:12.5px">
          Últimos 12 meses, con IVA incluido y ponderado por unidades.
          <span style="color:#166534;font-weight:700">&#9632; Rúcula</span>
          <span style="color:#84cc16;font-weight:700">&#9632; Lechuga</span>
          ${subioR !== null ? ` · la rúcula ${subioR >= 0 ? 'subió' : 'bajó'} ${Math.abs(subioR)}% en el período.` : ''}
        </p>
        <table style="border-collapse:collapse"><tbody><tr>${colsEvo}</tr></tbody></table>
        <p style="margin:6px 0 0;font-size:11px;color:#9ca3af">
          Hoy: rúcula $${Math.round(ultimo?.precioRucula || 0).toLocaleString('es-AR')} ·
          lechuga $${Math.round(ultimo?.precioLechuga || 0).toLocaleString('es-AR')}.
          Los kilos se pasan a paquetes con el peso real de las cosechas de cada mes.
        </p>

        <p style="margin:16px 0 0;font-size:11.5px;color:#9ca3af;line-height:1.5">
          <strong>El $/mes es una estimación.</strong> Es la diferencia de precio aplicada al volumen de los últimos
          ${DIAS_VOLUMEN} días, que no es necesariamente el que el cliente tenía cuando se le aumentó.
          Sumado da ${fmt$(impactoTotal)} por mes.
          ${sinRegistro ? `<br>${sinRegistro} ${sinRegistro === 1 ? 'cliente figura' : 'clientes figuran'} "sin registro": puede ser un cliente nuevo o uno al que nunca se le aumentó — desde acá se ven igual, porque el historial de precios empezó a llenarse en algún momento y lo anterior no quedó asentado.` : ''}
        </p>

        <p style="margin:18px 0 0">
          <a href="${URL_CLIENTES}" style="background:#166534;color:white;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:700;display:inline-block">
            Abrir precios por cliente
          </a>
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Xavia App <ventas@xavia.com.ar>',
        to: destinatarios,
        subject: atrasadosL.length
          ? `Precios por cliente — ${atrasadosL.length} sin aumento hace más de ${DIAS_ATRASO} días`
          : `Precios por cliente — ${activos.length} clientes`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    // Se anota DESPUÉS de que el mail salió. Al revés, un fallo de Resend dejaría el mes
    // marcado como mandado y el reporte no llegaría hasta el mes siguiente.
    //
    // Y se VERIFICA. Antes esto era `.catch(() => {})`: si la escritura fallaba, el fallo
    // se tragaba, el mes nunca quedaba marcado y el reporte salía todos los días. Un error
    // silencioso en el lugar exacto donde el silencio se nota como "llega demasiado".
    const guardado = await guardarUltimoMes(mes);

    return NextResponse.json({
      ok: true, enviado: true, hoy, mes, clientes: activos.length, atrasados: atrasadosL.length, destinatarios,
      // Si esto viene en false, el reporte va a repetirse hasta el día límite: la marca de
      // "ya se mandó" no se pudo escribir y hay que mirar la hoja Configuracion.
      guardado,
    });
  } catch (err: any) {
    console.error('[cron/reporte-precios] error:', err);
    return NextResponse.json({ error: err?.message || 'server_error' }, { status: 500 });
  }
}

// ── Dejar asentado qué mes se mandó ─────────────────────────────────────────────────
//
// Devuelve si quedó guardado DE VERDAD: se vuelve a leer la hoja para confirmarlo. Sin esa
// vuelta, una escritura que falla deja el mes sin marcar y el reporte sale todos los días
// —que es exactamente lo que pasó— sin que nada lo diga.
async function guardarUltimoMes(mes: string): Promise<boolean> {
  const { updateRow, appendRowObj, readSheet } = await import('@/lib/sheets');
  try {
    const ok = await updateRow('Configuracion', 'clave', CLAVE_ULTIMO, { valor: mes }).catch(() => false);
    if (!ok) await appendRowObj('Configuracion', { clave: CLAVE_ULTIMO, valor: mes });
    // La confirmación: lo que importa no es que la escritura no tirara error, sino que el
    // valor esté. Son cosas distintas cuando se escribe en una planilla por API.
    const filas = await readSheet<ConfigItem>('Configuracion').catch(() => [] as ConfigItem[]);
    return filas.some((c) => String(c.clave).trim() === CLAVE_ULTIMO && String(c.valor).trim() === mes);
  } catch (e) {
    console.error('[cron/reporte-precios] no se pudo guardar el último mes:', e);
    return false;
  }
}
