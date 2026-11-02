import Link from 'next/link';
import type { AlertaCajon } from '@/lib/cajones';
import type { ClienteSinPedir } from '@/lib/clientesSinPedir';
import type { PendienteSinFacturar } from '@/lib/alertasVentas';

// ── Las alertas de Ventas, en un solo lugar ──────────────────────────────────────────
//
// Server component: no tiene estado ni interacción, solo pinta lo que la página ya
// calculó. Va plegado cuando no hay nada —una franja verde de una línea— y abierto cuando
// sí: una sección que ocupa media pantalla para decir "todo bien" entrena a saltearla.

const fmtFecha = (f: string) => {
  const [y, m, d] = String(f || '').split('-');
  return d ? `${d}/${m}` : '—';
};

export default function AlertasVentas({ cajones, sinFacturar, sinPedir }: {
  cajones: AlertaCajon[];
  sinFacturar: PendienteSinFacturar[];
  sinPedir: ClienteSinPedir[];
}) {
  const total = cajones.length + sinFacturar.length + sinPedir.length;

  if (total === 0) {
    return (
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '8px 13px', marginBottom: '14px', fontSize: '12.5px', color: '#166534', fontWeight: 600 }}>
        ✓ Sin alertas: no hay cajones sin volver, nada sin facturar y ningún cliente que haya dejado de pedir.
      </div>
    );
  }

  // Lo que puede costar plata primero. Una venta sin facturar es plata que no se va a
  // cobrar nunca si no se factura; un cajón que no vuelve es un cajón; un cliente que dejó
  // de pedir es el más caro de los tres pero el que menos urge hoy.
  const bloques = [
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
      resto: Math.max(0, sinFacturar.length - 6),
    },
    cajones.length > 0 && {
      clave: 'cajones',
      color: '#9a3412', fondo: '#fff7ed', borde: '#fed7aa',
      titulo: `${cajones.length} ${cajones.length === 1 ? 'cliente con cajones sin volver' : 'clientes con cajones sin volver'}`,
      href: '/cajones', verTexto: 'Ver cajones →',
      filas: cajones.slice(0, 6).map((c) => ({
        clave: c.id_control,
        principal: c.nombre,
        secundario: `debe ${c.saldo} ${c.saldo === 1 ? 'cajón' : 'cajones'} · ${c.diasSinMovimiento} días sin movimiento`,
        grave: (c.diasSinMovimiento || 0) > 21,
      })),
      resto: Math.max(0, cajones.length - 6),
    },
    sinPedir.length > 0 && {
      clave: 'sinpedir',
      color: '#6d28d9', fondo: '#f5f3ff', borde: '#ddd6fe',
      titulo: `${sinPedir.length} ${sinPedir.length === 1 ? 'cliente dejó de pedir' : 'clientes dejaron de pedir'}`,
      href: '/ventas/historial', verTexto: '',
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
    },
  ].filter(Boolean) as {
    clave: string; color: string; fondo: string; borde: string; titulo: string;
    href: string; verTexto: string;
    filas: { clave: string; principal: string; secundario: string; grave: boolean }[];
    resto: number;
  }[];

  return (
    <div style={{ marginBottom: '14px' }}>
      <p style={{ margin: '0 0 7px', fontSize: '12px', fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        ⚠️ Alertas · {total}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '10px' }}>
        {bloques.map((b) => (
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
