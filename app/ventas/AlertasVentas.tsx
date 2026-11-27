import Link from 'next/link';
import type { AlertaCajon } from '@/lib/cajones';
import type { ClienteSinPedir } from '@/lib/clientesSinPedir';
import { DIAS_MAX_ALERTA, type PendienteSinFacturar } from '@/lib/alertasVentas';
import { queHacerConLaRepetida, type VentaRepetida, type FacturaRepetida } from '@/lib/duplicadosVenta';

// ── Las alertas de Ventas, en un solo lugar ──────────────────────────────────────────
//
// Server component: no tiene estado ni interacción, solo pinta lo que la página ya
// calculó. Va plegado cuando no hay nada —una franja verde de una línea— y abierto cuando
// sí: una sección que ocupa media pantalla para decir "todo bien" entrena a saltearla.

const fmtFecha = (f: string) => {
  const [y, m, d] = String(f || '').split('-');
  return d ? `${d}/${m}` : '—';
};

export default function AlertasVentas({ cajones, sinFacturar, sinFacturarViejas = 0, sinPedir, repetidas = [], facturasDobles = [] }: {
  cajones: AlertaCajon[];
  sinFacturar: PendienteSinFacturar[];
  // ── Lo único de esta pantalla que ya costó plata ───────────────────────────
  //
  // El 26-nov-2026 se duplicó la facturación de un día entero y la app no dijo nada: se
  // enteró Marcos mirando. Estas dos van primero y en rojo, y no se pliegan — son las
  // únicas donde esperar un día cambia lo que se puede hacer: hoy se borra una fila,
  // mañana se emite una nota de crédito.
  repetidas?: VentaRepetida[];
  facturasDobles?: FacturaRepetida[];
  // Las que quedaron afuera por tener más de DIAS_MAX_ALERTA días. Se dicen: un recorte
  // callado se lee como que no hay nada más, y son justamente las más fáciles de perder.
  sinFacturarViejas?: number;
  sinPedir: ClienteSinPedir[];
}) {
  const total = cajones.length + sinFacturar.length + sinPedir.length + repetidas.length + facturasDobles.length;

  if (total === 0) {
    return (
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '8px 13px', marginBottom: '14px', fontSize: '12.5px', color: '#166534', fontWeight: 600 }}>
        ✓ Sin alertas: ninguna venta cargada dos veces, no hay cajones sin volver, nada sin facturar de los últimos {DIAS_MAX_ALERTA} días y ningún cliente que haya dejado de pedir.
        {sinFacturarViejas > 0 && (
          <div style={{ marginTop: '4px', fontWeight: 400, color: '#15803d' }}>
            Quedan {sinFacturarViejas} venta(s) sin facturar de hace más de {DIAS_MAX_ALERTA} días, en{' '}
            <Link href="/ventas/historial" style={{ color: '#15803d', textDecoration: 'underline' }}>el historial</Link>.
          </div>
        )}
      </div>
    );
  }

  // Lo que puede costar plata primero. Una venta sin facturar es plata que no se va a
  // cobrar nunca si no se factura; un cajón que no vuelve es un cajón; un cliente que dejó
  // de pedir es el más caro de los tres pero el que menos urge hoy.
  const bloques = [
    // Las facturas que YA salieron dobles. Primero de todo: es plata que el cliente tiene
    // como deuda y que no le corresponde, y la única que no se arregla desde la app.
    facturasDobles.length > 0 && {
      clave: 'facturasdobles',
      color: '#991b1b', fondo: '#fef2f2', borde: '#fca5a5',
      titulo: `${facturasDobles.length} ${facturasDobles.length === 1 ? 'factura emitida dos veces' : 'facturas emitidas dos veces'}`,
      href: '/ventas/historial', verTexto: 'Ver el historial →',
      plegada: false,
      filas: facturasDobles.slice(0, 6).map((f) => ({
        clave: `${f.fecha}__${f.cliente}__${f.importe}`,
        principal: `${f.cliente} · ${fmtFecha(f.fecha)}`,
        secundario: `${f.numeros.join(' y ')} — las dos por $${f.importe.toLocaleString('es-AR')}`,
        grave: true,
      })),
      resto: Math.max(0, facturasDobles.length - 6),
      pie: 'Mismo cliente, mismo día, mismo importe. Si una está de más hay que anularla con una '
        + 'nota de crédito: ya está en AFIP y al cliente le figura como deuda.',
    },
    // Las ventas cargadas dos veces. Son la causa, y mientras no se facturen se arreglan
    // borrando una fila — gratis. Por eso van arriba de todo lo que no es una factura doble.
    repetidas.length > 0 && {
      clave: 'repetidas',
      color: '#b91c1c', fondo: '#fef2f2', borde: '#fecaca',
      titulo: `${repetidas.length} ${repetidas.length === 1 ? 'venta cargada dos veces' : 'ventas cargadas dos veces'}`,
      href: '/ventas/historial', verTexto: 'Ver el historial →',
      plegada: false,
      filas: repetidas.slice(0, 6).map((r) => ({
        clave: `${r.fecha}__${r.id_control}__${r.sucursal}`,
        principal: `${r.cliente}${r.sucursal ? ` (${r.sucursal})` : ''} · ${fmtFecha(r.fecha)}`,
        secundario: queHacerConLaRepetida(r),
        grave: r.forma !== 'por_facturar',
      })),
      resto: Math.max(0, repetidas.length - 6),
      pie: 'Pasa cuando se vuelve a cargar una venta que ya se facturó: la fila vieja no se '
        + 'reusa porque ya salió, y nace otra. Las que todavía no se facturaron se borran sin consecuencias.',
    },
    sinFacturar.length > 0 && {
      clave: 'facturar',
      color: '#b45309', fondo: '#fffbeb', borde: '#fde68a',
      titulo: `${sinFacturar.length} ${sinFacturar.length === 1 ? 'venta cargada sin facturar' : 'ventas cargadas sin facturar'}`,
      href: '/ventas/historial', verTexto: 'Ver el historial →',
      filas: sinFacturar.slice(0, 6).map((p) => ({
        clave: `${p.fecha}__${p.id_control}`,
        principal: `${p.cliente} · ${fmtFecha(p.fecha)}`,
        secundario: p.huboFacturaEseDia
          // El caso más común y el más confuso: ese día SÍ se le facturó. Decirlo acá
          // evita volver a facturarle al cliente algo que ya pagó.
          ? `hace ${p.dias} días — ese día ya se le facturó, puede ser una carga repetida`
          : `hace ${p.dias} días — falta facturar`,
        grave: !p.huboFacturaEseDia,
      })),
      // Esta NO se pliega: una venta sin facturar se arregla cargando, que es lo que se
      // viene a hacer a esta pantalla.
      plegada: false,
      resto: Math.max(0, sinFacturar.length - 6),
      // Lo viejo no entra en la alerta para no tapar lo de esta semana, pero se cuenta.
      pie: sinFacturarViejas > 0
        ? `Hay ${sinFacturarViejas} más de hace más de ${DIAS_MAX_ALERTA} días. No entran acá para que no tapen las de esta semana — están en el historial.`
        : null,
    },
    cajones.length > 0 && {
      clave: 'cajones',
      color: '#9a3412', fondo: '#fff7ed', borde: '#fed7aa',
      titulo: `${cajones.length} ${cajones.length === 1 ? 'cliente con cajones sin volver' : 'clientes con cajones sin volver'}`,
      href: '/cajones', verTexto: 'Ver cajones →',
      // ── Plegada ───────────────────────────────────────────────────────────────────
      //
      // Esta pantalla es para CARGAR la venta del día, y había cuatro bloques de alertas
      // arriba de todo empujando el formulario abajo del pliegue. Los cajones no se
      // resuelven cargando una venta: son una gestión aparte, de otro día.
      //
      // Se pliega, no se saca: el número sigue a la vista y se abre de un click. Y para que
      // no dependa de que alguien lo abra, sale por mail a Juan Pablo los lunes (ver
      // /api/cron/cajones-lunes).
      plegada: true,
      filas: cajones.slice(0, 6).map((c) => ({
        clave: c.id_control,
        principal: c.nombre,
        secundario: `debe ${c.saldo} ${c.saldo === 1 ? 'cajón' : 'cajones'} · ${c.diasSinMovimiento} días sin movimiento`,
        grave: (c.diasSinMovimiento || 0) > 21,
      })),
      resto: Math.max(0, cajones.length - 6),
      pie: null,
    },
    sinPedir.length > 0 && {
      clave: 'sinpedir',
      color: '#6d28d9', fondo: '#f5f3ff', borde: '#ddd6fe',
      titulo: `${sinPedir.length} ${sinPedir.length === 1 ? 'cliente dejó de pedir' : 'clientes dejaron de pedir'}`,
      href: '/ventas/historial', verTexto: '',
      // Mismo criterio que los cajones: es una tarea de seguimiento comercial, no de la
      // carga del día. Ya sale por mail a Juan Pablo (email_clientes_sin_pedir).
      plegada: true,
      filas: sinPedir.slice(0, 6).map((c) => ({
        clave: c.id_control,
        principal: c.nombre,
        // El volumen va porque no es lo mismo perder al que compraba todas las semanas que
        // al que compraba una vez por mes, y el nombre solo no lo dice.
        secundario: `${c.dias} días sin pedir · última ${fmtFecha(c.ultimaVenta)}`
          + (c.vecesUltimas8Semanas > 0 ? ` · venía pidiendo ${c.vecesUltimas8Semanas} veces en 8 semanas` : ''),
        grave: c.vecesUltimas8Semanas >= 6,
      })),
      resto: Math.max(0, sinPedir.length - 6),
      pie: null,
    },
  ].filter(Boolean) as {
    clave: string; color: string; fondo: string; borde: string; titulo: string;
    href: string; verTexto: string; plegada?: boolean;
    filas: { clave: string; principal: string; secundario: string; grave: boolean }[];
    resto: number;
    pie: string | null;
  }[];

  return (
    <div style={{ marginBottom: '14px' }}>
      <p style={{ margin: '0 0 7px', fontSize: '12px', fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        ⚠️ Alertas · {total}
      </p>
      {/* Las plegadas van juntas y en una línea: ocupan lo que ocupa su título. */}
      {bloques.some((b) => b.plegada) && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: bloques.some((b) => !b.plegada) ? '10px' : 0 }}>
          {bloques.filter((b) => b.plegada).map((b) => (
            <details key={b.clave} style={{ background: b.fondo, border: `1px solid ${b.borde}`, borderRadius: '9px', padding: '7px 11px', flex: '1 1 290px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '12.5px', fontWeight: 800, color: b.color, listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                <span>{b.titulo}</span>
                <span style={{ fontSize: '11px', fontWeight: 600, color: b.color, opacity: 0.75 }}>ver ▾</span>
              </summary>
              <div style={{ marginTop: '7px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {b.filas.map((f) => (
                  <div key={f.clave} style={{ fontSize: '12px', lineHeight: 1.4 }}>
                    <span style={{ fontWeight: f.grave ? 700 : 600, color: '#374151' }}>{f.principal}</span>
                    <span style={{ color: '#6b7280' }}> — {f.secundario}</span>
                  </div>
                ))}
                {b.resto > 0 && <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#9ca3af' }}>y {b.resto} más</p>}
                {b.verTexto && (
                  <Link href={b.href} style={{ fontSize: '11.5px', color: b.color, fontWeight: 600, marginTop: '3px' }}>{b.verTexto}</Link>
                )}
                <p style={{ margin: '4px 0 0', fontSize: '10.5px', color: '#9ca3af' }}>
                  Esto también le llega a Juan Pablo por mail los lunes.
                </p>
              </div>
            </details>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '10px' }}>
        {bloques.filter((b) => !b.plegada).map((b) => (
          <div key={b.clave} style={{ background: b.fondo, border: `1px solid ${b.borde}`, borderRadius: '9px', padding: '11px 13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: b.color }}>{b.titulo}</p>
              {b.verTexto && (
                <Link href={b.href} style={{ fontSize: '11.5px', color: b.color, whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {b.verTexto}
                </Link>
              )}
            </div>
            <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {b.filas.map((f) => (
                <div key={f.clave} style={{ fontSize: '12px', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: f.grave ? 700 : 600, color: '#374151' }}>{f.principal}</span>
                  <span style={{ color: '#6b7280' }}> — {f.secundario}</span>
                </div>
              ))}
              {b.resto > 0 && (
                <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#9ca3af' }}>y {b.resto} más</p>
              )}
              {b.pie && (
                <p style={{ margin: '4px 0 0', fontSize: '11.5px', color: '#9ca3af' }}>{b.pie}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
