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
      <Header user={user} current="estadisticas" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h1 className="page-title">Cómo cerrar el mes</h1>
            <p className="page-subtitle">El orden importa: cada paso usa lo del anterior</p>
          </div>
          <Link href="/eerr" className="btn secondary" style={{ fontSize: '12px' }}>← Volver al EERR</Link>
        </div>

        <div className="card" style={{ marginTop: '14px' }}>
          <h2 style={{ ...h2, marginTop: 0 }}>1. Bajá los resúmenes del banco</h2>
          <p style={p}>
            Macro y Brubank, del mes que estás cerrando. De acá salen los tres pasos que siguen, así que conviene
            tenerlos abiertos al lado mientras cargás.
          </p>
          <p style={p}>No hace falta reformatearlos ni compararlos contra nada todavía: se usan como fuente para leer.</p>

          <h2 style={h2}>2. Cargá los gastos que solo aparecen en el resumen</h2>
          <p style={p}>
            Sueldos, nafta, viáticos y todo lo que se paga durante el mes pero es más cómodo registrar de una vez
            al final. Se cargan en <Link href="/gastos" style={{ color: '#2563eb', fontWeight: 600 }}>Gastos</Link> con
            la fecha real en que salió la plata, no con la de hoy.
          </p>
          <p style={p}>
            Aparte están los <strong>débitos automáticos</strong>: impuesto al cheque, comisiones y mantenimiento de
            cuenta. Un mes puede tener cincuenta líneas de impuesto al cheque de trescientos pesos cada una.
          </p>
          <div style={nota}>
            <strong>No los cargues de a uno.</strong> Sumá en el resumen todo lo que es impuesto al cheque y cargá
            una sola línea, «Impuesto al cheque — septiembre», categoría Impuestos, con el banco como medio de pago.
            Lo mismo con comisiones. Para el resultado y para el saldo da exactamente igual, y son dos líneas en vez
            de cincuenta.
          </div>

          <h2 style={h2}>3. Desglosá el resumen de la tarjeta</h2>
          <p style={p}>
            Cada consumo va como un gasto con medio de pago <strong>VISA</strong> y la fecha en que se consumió —
            aunque sea de un mes anterior. El EERR no se cierra nunca: si cargás algo de agosto estando en
            septiembre, agosto se recalcula solo.
          </p>
          <div style={nota}>
            <strong>El pago del resumen no es un gasto.</strong> Cuando la tarjeta se debita del banco, eso se carga
            con la categoría «Movimiento entre medios de pago», eligiendo de dónde sale y a dónde entra. Si se
            cargara como gasto, cada compra con tarjeta contaría dos veces en el resultado del mes.
          </div>

          <h2 style={h2}>4. Contá el stock y aplicá las compras</h2>
          <p style={p}>
            En <Link href="/stocks" style={{ color: '#2563eb', fontWeight: 600 }}>Stocks</Link>, cargá el stock final
            de cada artículo. Sin el recuento no hay costo variable: la cuenta es{' '}
            <span style={{ fontFamily: 'monospace' }}>inicial + compras − final</span>, y un final vacío haría que el
            consumo dé igual a todo el stock inicial.
          </p>
          <p style={p}>
            Revisá también las <strong>sugerencias de compra desde Gastos</strong>: un gasto de insumos sin aplicar a
            stock no está en el costo de ningún lado.
          </p>

          <h2 style={h2}>5. Cargá el total cobrado por cuenta</h2>
          <p style={p}>
            En el EERR, en «Cobranzas y saldos». Del resumen sacás cuánto entró a cada banco; de las cajas, lo que te
            pasaron los socios. Una línea por cuenta alcanza — no hace falta detallar por cliente.
          </p>
          <p style={p}>
            El cliente es un campo opcional. Si lo completás, la app se va acercando a poder calcular deudores por
            venta sin Xubio; si no, los saldos igual dan bien.
          </p>

          <h2 style={h2}>6. Cargá el saldo real de cada cuenta</h2>
          <p style={p}>
            El que dice el resumen al último día del mes. La app ya calculó cuánto debería haber, y la diferencia
            entre los dos números <strong>es</strong> la conciliación: si no da ✓, hay plata que se movió sin quedar
            registrada — casi siempre un gasto o una cobranza que falta cargar.
          </p>
          <div style={nota}>
            <strong>La primera vez</strong> las cuentas no tienen saldo inicial, porque sale del cierre del mes
            anterior y todavía no existe. Cargalo a mano en la columna «Inicial»: se hace una sola vez y de ahí en
            más se encadena solo.
          </div>

          <h2 style={h2}>7. Guardá previsiones y cuentas corrientes</h2>
          <p style={p}>
            Despidos y SAC salen de la masa salarial del mes y la app los propone, pero hay que guardarlos: así el
            mes queda fijo y no cambia de números si mañana se corrige un sueldo cargado tarde. Alquiler y EPE van a
            mano.
          </p>

          <h2 style={h2}>8. Compará contra tu Excel</h2>
          <p style={p}>
            Armalo como siempre y contrastá línea por línea. Donde no dé, o falta un dato en la app o está mal el
            cálculo — encontrar cuál de las dos también es ganancia.
          </p>

          <h2 style={h2}>Qué va en la app y qué va en Xubio</h2>
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
