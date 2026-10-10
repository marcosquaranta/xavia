import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

const h2: React.CSSProperties = { fontSize: '15px', fontWeight: 700, margin: '26px 0 6px' };
const p: React.CSSProperties = { margin: '0 0 10px', fontSize: '13.5px', lineHeight: 1.6, color: '#374151', maxWidth: '70ch' };
const li: React.CSSProperties = { fontSize: '13.5px', lineHeight: 1.6, color: '#374151', marginBottom: '6px' };
const nota: React.CSSProperties = {
  margin: '10px 0 0', fontSize: '12.5px', lineHeight: 1.55, color: '#4b5563',
  background: '#fafaf9', border: '1px solid #e5e7eb', borderRadius: '7px', padding: '10px 12px', maxWidth: '70ch',
};

export default async function InstruccionesCierrePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  return (
    <>
      <Header user={user} current="eerr" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h1 className="page-title">Qué va en la app y qué queda en Xubio</h1>
            <p className="page-subtitle">
              Los pasos del cierre, con su estado, están en el checklist del EERR. Acá queda la regla de trabajo.
            </p>
          </div>
          <Link href="/eerr" className="btn secondary" style={{ fontSize: '12px' }}>← Volver al EERR</Link>
        </div>

        <div className="card" style={{ marginTop: '14px' }}>
          <h2 style={{ ...h2, marginTop: 0 }}>La regla</h2>
          <p style={p}>
            La regla es una sola: <strong>la app es donde se carga y donde se mira; Xubio es donde se emite la
            factura.</strong> Todo lo que se cargue directo en Xubio, la app no lo tiene — y eso es lo único que
            obliga a seguir entrando ahí para cerrar el mes.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(270px,1fr))', gap: '12px', margin: '12px 0' }}>
            <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: '8px', padding: '12px 14px' }}>
              <p style={{ margin: '0 0 8px', fontSize: '12.5px', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Se carga en la app
              </p>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                <li style={li}><strong>Las ventas del día</strong>, y desde ahí se emite la factura. La app se la manda a Xubio y guarda el número y el CAE.</li>
                <li style={li}><strong>Los cobros</strong>, con su retención si la hubo. La app crea la cobranza en Xubio; cargarla allá a mano la deja afuera de la app.</li>
                <li style={li}><strong>Todos los gastos</strong>, incluidos los del resumen de la tarjeta (se pegan de una) y los que se pagan a 30 días, que van como deuda a proveedor.</li>
                <li style={li}><strong>El stock final de cada insumo</strong>, que es de donde sale el costo variable.</li>
                <li style={li}><strong>Los saldos reales</strong> de cada banco y cada caja, del resumen.</li>
                <li style={li}><strong>Las previsiones</strong> del mes: despidos y SAC.</li>
              </ul>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px' }}>
              <p style={{ margin: '0 0 8px', fontSize: '12.5px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Queda en Xubio
              </p>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                <li style={li}><strong>La factura electrónica y el CAE.</strong> Es el respaldo fiscal y sale de ahí, pero se emite DESDE la app.</li>
                <li style={li}><strong>IVA, libros y todo lo del contador.</strong> No hace falta para el cierre de gestión: el EERR trabaja en neto.</li>
                <li style={li}><strong>Las notas de crédito</strong>, mientras se sigan haciendo. Hoy la decisión es corregir la venta en la app antes de facturar en vez de emitir una.</li>
              </ul>
            </div>
          </div>

          <div style={{ ...nota, background: '#fffbeb', borderColor: '#fde68a' }}>
            <strong>Lo que ya no tiene sentido hacer:</strong> cargar una factura o una cobranza directo en Xubio.
            No está prohibido —a veces no queda otra— pero cada una de esas la app no la ve, y es lo que hace que
            el cierre siga dependiendo de abrir Xubio. El informe de facturación de los lunes te dice cuántas
            hubo, con nombre y monto: cuando ese número llegue a cero, el mes se cierra entero desde acá.
          </div>

          <div style={{ ...nota, marginTop: '14px', background: '#f0fdf4', borderColor: '#bbf7d0' }}>
            <strong>Y lo que ya no hace falta mirar en Xubio:</strong> cuánto se facturó, cuánto se cobró, quién
            debe, en qué cuenta entró cada cobro y qué saldo tiene cada cuenta. Todo eso está en la app, sale de
            una copia local que se actualiza sola todas las mañanas, y se puede refrescar a mano cuando haga falta.
          </div>
        </div>
      </div>
    </>
  );
}
