import Link from 'next/link';

// ── Qué entregas del día todavía no confirmó el reparto ──────────────────────────────
//
// Es todo lo que esta función agrega a Facturación y al Historial: una franja arriba, y
// solo cuando hay algo. La pantalla ya se usa todos los días y acaba de recibir el freno de
// duplicados y el acuse; meterle columnas, filtros o pestañas nuevas sería cambiarle el
// trabajo a alguien que no lo pidió.
//
// A las 16 el cron las factura igual con lo que se cargó (ver api/cron/cierre-entregas),
// así que esto no es una tarea pendiente: es saber por qué una venta de hoy todavía no
// tiene comprobante.
export default function EsperandoReparto({ entregas }: { entregas: { cliente: string; sucursal: string }[] }) {
  if (!entregas.length) return null;
  const n = entregas.length;
  return (
    <div style={{
      border: '1px solid #e5e7eb', borderLeft: '4px solid #d97706', background: '#fffbeb',
      borderRadius: '8px', padding: '12px 15px', marginBottom: '14px',
    }}>
      <div style={{ fontSize: '14px', fontWeight: 800, color: '#92400e', marginBottom: '3px' }}>
        {n} {n === 1 ? 'entrega de hoy espera' : 'entregas de hoy esperan'} que el reparto confirme
      </div>
      <div style={{ fontSize: '12.5px', color: '#78350f', lineHeight: 1.5 }}>
        {entregas.slice(0, 8).map((e) => `${e.cliente}${e.sucursal ? ` (${e.sucursal})` : ''}`).join(' · ')}
        {n > 8 ? ` y ${n - 8} más` : ''}.
      </div>
      <div style={{ fontSize: '12px', color: '#a16207', marginTop: '6px' }}>
        Si nadie las confirma, se facturan solas a las 16 con lo que se cargó.{' '}
        <Link href="/reparto" style={{ color: '#92400e', fontWeight: 700 }}>Ver las entregas del día</Link>
      </div>
    </div>
  );
}
