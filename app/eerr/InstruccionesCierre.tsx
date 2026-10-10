import Link from 'next/link';

// ── La regla de trabajo, en la pantalla del cierre ────────────────────────────────────
//
// Esto vivía en /eerr/instrucciones, una página aparte. El problema de una página aparte es
// que nadie entra: se cierra el mes en /eerr, y la regla que explica POR QUÉ se carga todo
// en la app —y qué pasa si no— quedaba a un click que nunca se daba. Ahora está acá abajo,
// en la misma pantalla, plegada.
//
// Junto con el checklist de arriba son UNA sola instrucción: el checklist dice qué hacer y
// en qué orden (con su "cómo se hace" en cada paso), y esto dice dónde vive cada cosa y qué
// ya no hay que hacer.

const li: React.CSSProperties = { fontSize: '12.5px', lineHeight: 1.55, color: '#374151', marginBottom: '5px' };
const nota: React.CSSProperties = {
  margin: '10px 0 0', fontSize: '12.5px', lineHeight: 1.55, color: '#4b5563',
  border: '1px solid #e5e7eb', borderRadius: '7px', padding: '9px 11px',
};

export default function InstruccionesCierre() {
  return (
    <details className="card" style={{ marginTop: '12px', background: '#fafaf9' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'revert', fontSize: '13px', fontWeight: 700, color: '#111827' }}>
        Qué va en la app y qué queda en Xubio
        <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: '12px' }}>
          {' '}· la regla de trabajo, y lo que ya no hay que hacer
        </span>
      </summary>

      <p style={{ margin: '10px 0 0', fontSize: '13px', lineHeight: 1.6, color: '#374151', maxWidth: '72ch' }}>
        La regla es una sola: <strong>la app es donde se carga y donde se mira; Xubio es donde se emite la
        factura.</strong> Todo lo que se cargue directo en Xubio, la app no lo tiene — y eso es lo único que obliga
        a seguir entrando ahí para cerrar el mes.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '10px', margin: '11px 0 0' }}>
        <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: '8px', padding: '11px 13px' }}>
          <p style={{ margin: '0 0 7px', fontSize: '11.5px', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Se carga en la app
          </p>
          <ul style={{ margin: 0, paddingLeft: '17px' }}>
            <li style={li}><strong>Las ventas del día</strong>, y desde ahí se emite la factura. La app se la manda a Xubio y guarda el número y el CAE.</li>
            <li style={li}><strong>Los cobros</strong>, con su retención si la hubo. La app crea la cobranza en Xubio; cargarla allá a mano la deja afuera de la app.</li>
            <li style={li}><strong>Todos los gastos</strong>, incluidos los del resumen de la tarjeta y los del banco (se pegan de una) y los que se pagan a 30 días, que van como deuda a proveedor.</li>
            <li style={li}><strong>El stock final de cada insumo</strong>, que es de donde sale el costo variable.</li>
            <li style={li}><strong>Los saldos reales</strong> de cada banco y cada caja, del resumen.</li>
            <li style={li}><strong>Las previsiones</strong> del mes: despidos y SAC — se guardan solas una vez por mes.</li>
          </ul>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '11px 13px' }}>
          <p style={{ margin: '0 0 7px', fontSize: '11.5px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Queda en Xubio
          </p>
          <ul style={{ margin: 0, paddingLeft: '17px' }}>
            <li style={li}><strong>La factura electrónica y el CAE.</strong> Es el respaldo fiscal y sale de ahí, pero se emite DESDE la app.</li>
            <li style={li}><strong>IVA, libros y todo lo del contador.</strong> No hace falta para el cierre de gestión: el EERR trabaja en neto.</li>
            <li style={li}><strong>Las notas de crédito</strong>, mientras se sigan haciendo. Hoy la decisión es corregir la venta en la app antes de facturar en vez de emitir una.</li>
          </ul>
        </div>
      </div>

      {/* ── Lo que ya no hay que hacer ──────────────────────────────────────────────────
          Los tres lugares donde el cierre anterior se comió horas. Están acá y no en el
          checklist a propósito: el checklist dice qué HACER, y esto es lo contrario — si
          alguien lo hace por costumbre, está perdiendo el tiempo dos veces. */}
      <div style={{ ...nota, background: '#f0fdf4', borderColor: '#bbf7d0' }}>
        <p style={{ margin: '0 0 6px', fontWeight: 700, color: '#166534' }}>Lo que ya no hay que hacer</p>
        <ul style={{ margin: 0, paddingLeft: '17px' }}>
          <li style={li}>
            <strong>Pasar los gastos y los movimientos a Xubio.</strong> Si están cargados en la app, ya están donde se
            miran: el resultado, los saldos y la conciliación salen de acá. Xubio los necesita para IVA y libros, y eso
            lo arma el contador con el resumen del banco.
          </li>
          <li style={li}>
            <strong>Cargar la tarjeta y el banco movimiento por movimiento.</strong> Se pegan enteros en{' '}
            <Link href="/gastos" style={{ color: '#2563eb', fontWeight: 600 }}>Gastos → Cargar varios gastos de una</Link>{' '}
            y salen todos juntos, cada uno con su fecha y su categoría. La app además avisa si una línea pegada repite un
            gasto que ya estaba cargado, así que pegar dos veces el mismo resumen no duplica nada.
          </li>
          <li style={li}>
            <strong>Ir para atrás de mes en mes.</strong> El cierre abre siempre en el <strong>último mes cerrado</strong>,
            no en el mes en curso. El mes en curso está a un click del botón de siguiente, pero su resultado no significa
            nada: son los ingresos de unos días contra los gastos fijos del mes entero.
          </li>
        </ul>
      </div>

      <div style={{ ...nota, background: '#fffbeb', borderColor: '#fde68a' }}>
        <strong>Lo único que todavía no conviene hacer en Xubio:</strong> cargar una factura o una cobranza directo allá.
        No está prohibido —a veces no queda otra— pero cada una de esas la app no la ve, y es lo que hace que el cierre
        siga dependiendo de abrir Xubio. El informe de facturación de los lunes te dice cuántas hubo, con nombre y monto:
        cuando ese número llegue a cero, el mes se cierra entero desde acá.
      </div>

      <div style={{ ...nota, background: '#f0fdf4', borderColor: '#bbf7d0' }}>
        <strong>Y lo que ya no hace falta mirar en Xubio:</strong> cuánto se facturó, cuánto se cobró, quién debe, en qué
        cuenta entró cada cobro y qué saldo tiene cada cuenta. Todo eso está en la app, sale de una copia local que se
        actualiza sola todas las mañanas, y se puede refrescar a mano cuando haga falta.
      </div>
    </details>
  );
}
