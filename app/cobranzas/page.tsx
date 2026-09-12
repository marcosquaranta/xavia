import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { readSheet } from '@/lib/sheets';
import {
  HOJA_RECORDATORIOS, COL_ACTIVO, COL_EMAIL, CONFIG_DATOS_PAGO, DATOS_PAGO_DEFAULT,
  DIAS_VENTANA, type RecordatorioCobro,
} from '@/lib/recordatoriosCobro';
import { nombreClienteVisible } from '@/lib/clientes';
import { HOJA_COBROS, type CobroRegistrado } from '@/lib/cobros';
import type { ClienteVenta } from '@/lib/types';
import Header from '@/components/Header';
import { ClientesRecordatorio, DatosPago, ProbarRecordatorios, type ClienteFila } from '@/components/CobranzasConfig';
import RegistrarCobro from '@/components/RegistrarCobro';

export const dynamic = 'force-dynamic';

const fmtFechaHora = (iso: string) => {
  const [f, h] = String(iso || '').split('T');
  const [y, m, d] = (f || '').split('-');
  return d ? `${d}/${m} ${(h || '').slice(0, 5)}` : '—';
};

export default async function CobranzasPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  let clientes: ClienteVenta[] = [], enviados: RecordatorioCobro[] = [], configRows: { clave: string; valor: any }[] = [];
  let cobros: CobroRegistrado[] = [];
  try {
    [clientes, enviados, configRows, cobros] = await Promise.all([
      readSheet<ClienteVenta>('Clientes').catch(() => []),
      readSheet<RecordatorioCobro>(HOJA_RECORDATORIOS).catch(() => []),
      readSheet<{ clave: string; valor: any }>('Configuracion').catch(() => []),
      readSheet<CobroRegistrado>(HOJA_COBROS).catch(() => []),
    ]);
  } catch {}

  const filas: ClienteFila[] = clientes
    .filter((c) => String(c.activo || '').toUpperCase() !== 'NO')
    .map((c) => ({
      id_control: c.id_control,
      nombre: nombreClienteVisible(c),
      activo: String((c as any)[COL_ACTIVO] || '').trim().toUpperCase() === 'SI',
      email: String((c as any)[COL_EMAIL] || ''),
      emailGeneral: String(c.email || ''),
    }))
    // Los prendidos primero: son los que se miran.
    .sort((a, b) => (a.activo === b.activo ? a.nombre.localeCompare(b.nombre) : a.activo ? -1 : 1));

  const datosPagoFila = configRows.find((r) => String(r.clave).trim() === CONFIG_DATOS_PAGO);
  const datosPago = String(datosPagoFila?.valor || '').trim() || DATOS_PAGO_DEFAULT;

  const historial = [...enviados]
    .sort((a, b) => String(b.fecha_envio || '').localeCompare(String(a.fecha_envio || '')))
    .slice(0, 25);
  const prendidos = filas.filter((f) => f.activo).length;

  return (
    <>
      <Header user={user} current="ventas" />
      <div className="container">
        <h1 className="page-title">Cobranzas</h1>
        <p className="page-subtitle">
          Registrar cobros en Xubio · recordatorios semanales a los clientes elegidos (salen los lunes a la mañana)
        </p>

        {/* Lo que la app NO puede saber, dicho antes de que alguien lo asuma al revés. */}
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '11px 14px', marginBottom: '14px' }}>
          <p style={{ margin: 0, fontSize: '12.5px', color: '#92400e', lineHeight: 1.5 }}>
            <strong>Xubio no permite saber si una factura puntual está paga</strong> — no existe ese dato en su API.
            Lo que sí hace la app es comparar lo facturado contra lo cobrado de cada cliente (últimos 120 días):
            si el cliente está al día, el recordatorio no sale. Y cada comprobante entra en un solo recordatorio,
            así nunca se reclama dos veces lo mismo.
          </p>
        </div>

        {/* ══ REGISTRAR UN COBRO ══ */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Registrar un cobro en Xubio</p>
          <p className="card-sub">
            Lo que cargues acá se crea en Xubio como cobranza del cliente. Entra a su cuenta corriente
            como cobro a cuenta: la API de Xubio no permite imputarlo a una factura puntual, eso sigue
            siendo a mano si hace falta. Un cobro mal cargado se puede anular desde acá.
          </p>
          <div style={{ marginTop: '10px' }}>
            <RegistrarCobro
              clientes={filas.map((f) => ({ id_control: f.id_control, nombre: f.nombre }))}
              cobros={[...cobros]
                .sort((a, b) => String(b.fecha_registro || '').localeCompare(String(a.fecha_registro || '')))
                .slice(0, 15)
                .map((c) => ({
                  id_cobro: c.id_cobro, cliente: c.cliente, fecha: c.fecha,
                  importe: Number(c.importe) || 0, numero_recibo: String(c.numero_recibo || ''),
                  transaccionid: String(c.transaccionid || ''), estado: String(c.estado || ''),
                  observacion: String(c.observacion || ''),
                }))}
            />
          </div>
        </div>

        <div className="card" style={{ marginBottom: '14px' }}>
          <p className="card-title">Clientes con recordatorio</p>
          <p className="card-sub">{prendidos === 0 ? 'Ninguno prendido todavía' : `${prendidos} prendido${prendidos > 1 ? 's' : ''}`}</p>
          <div style={{ marginTop: '10px' }}>
            <ClientesRecordatorio clientes={filas} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '14px', marginBottom: '14px', alignItems: 'start' }}>
          <div className="card" style={{ margin: 0 }}>
            <p className="card-title">Datos de pago del mail</p>
            <p className="card-sub">Se incluyen en cada recordatorio, tal cual los escribas acá</p>
            <div style={{ marginTop: '10px' }}>
              <DatosPago valor={datosPago} />
            </div>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <p className="card-title">Probar</p>
            <p className="card-sub">
              La simulación muestra a quién le llegaría y con qué facturas, sin mandar nada.
              Mira los últimos {DIAS_VENTANA} días para cubrir una semana en que falle el envío automático.
            </p>
            <div style={{ marginTop: '10px' }}>
              <ProbarRecordatorios />
            </div>
          </div>
        </div>

        <div className="card">
          <p className="card-title">Últimos recordatorios enviados</p>
          {historial.length === 0 ? (
            <p style={{ margin: '8px 0 0', fontSize: '12.5px', color: '#9ca3af' }}>Todavía no se envió ninguno.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '560px' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', color: '#6b7280' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Enviado</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Cliente</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Comprobantes</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Importe</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((r) => (
                    <tr key={r.id_recordatorio} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '6px 8px', color: '#6b7280' }}>{fmtFechaHora(r.fecha_envio)}</td>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.cliente}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '11px' }}>{r.comprobantes}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>${Math.round(Number(r.importe) || 0).toLocaleString('es-AR')}</td>
                      <td style={{ padding: '6px 8px', color: String(r.estado) === 'enviado' ? '#059669' : '#dc2626', fontWeight: 600 }}>
                        {String(r.estado) === 'enviado' ? '✓ Enviado' : `✕ ${r.estado}`}
                        {r.detalle && <span style={{ color: '#9ca3af', fontWeight: 400 }}> · {r.detalle}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
