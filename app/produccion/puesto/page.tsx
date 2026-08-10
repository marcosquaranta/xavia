import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import Header from '@/components/Header';
export const dynamic = 'force-dynamic';

// Documento consolidado a partir del intercambio de mails entre Marcos y Marcelo
// (borrador inicial de Marcelo → comentarios/ajustes de Marcos → respuesta final de
// Marcelo, 5/8/2026) — no es el mail original ni un solo borrador, es la CONCLUSIÓN de
// esa conversación: en cada punto donde hubo ida y vuelta, queda la versión en la que
// los dos coincidieron. Los dos puntos que quedaron explícitamente abiertos (sin cerrar
// entre ellos) se marcan como tal más abajo, no se inventa un cierre que no hubo.

function Seccion({ n, titulo, children }: { n?: string; titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '22px' }}>
      <p style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 800, color: '#111827' }}>{n ? `${n}. ` : ''}{titulo}</p>
      <div style={{ fontSize: '13.5px', color: '#374151', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}
function Item({ children }: { children: React.ReactNode }) {
  return <li style={{ marginBottom: '6px' }}>{children}</li>;
}

export default async function PuestoProduccionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.rol !== 'admin') redirect('/panel');

  return (
    <>
      <Header user={user} current="estadisticas" />
      <div className="container" style={{ maxWidth: '760px' }}>
        <Link href="/estadisticas" style={{ fontSize: '13px', display: 'inline-block', marginBottom: '14px' }}>← Volver a Estadísticas</Link>

        <div className="card" style={{ marginBottom: '16px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Perfil operativo · XAVIA</p>
          <h1 style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 800 }}>Descripción del puesto — Responsable de Producción</h1>
          <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>
            Versión consolidada del acuerdo entre Marcos y Marcelo (borrador inicial → ajustes → respuesta final, cerrado el 5/8/2026).
            Refleja lo efectivamente acordado en cada punto — no es el mail original.
          </p>
        </div>

        <div className="card">
          <Seccion n="1" titulo="Alcance del rol">
            <p>
              La presencia es de lunes a viernes de 8 a 12/13hs (entre 4 y 5 horas diarias) en el invernadero, con foco en
              liderar y ordenar la operación diaria. El horario puede estar sujeto a cambios, cuanto más temprano se pueda
              estar en el invernadero mejor.
            </p>
          </Seccion>

          <Seccion n="2" titulo="Tareas dentro de la jornada presencial">
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              <Item><strong>Liderazgo operativo y gestión del personal en lo productivo:</strong> organizar tareas y protocolos, supervisar el desempeño, detectar desvíos y acompañar/capacitar al equipo en lo que hace al trabajo diario del invernadero.</Item>
              <Item><strong>Planificación de la producción:</strong> coordinar siembras, trasplantes y cosechas, planificar la ocupación de las naves y optimizar tiempos y capacidad.</Item>
              <Item><strong>Control productivo y de calidad:</strong> monitorear el estado de los cultivos, detectar problemas sanitarios o nutricionales y definir acciones correctivas.</Item>
              <Item><strong>Solución nutritiva y fertirriego:</strong> medir, controlar y corregir pH y EC en los tanques sin automatización, y preparar la solución nutritiva y sus recetas.</Item>
              <Item><strong>Seguimiento de procesos:</strong> asegurar el cumplimiento de protocolos, seguir impulsando el uso de la app y los registros, y delegar progresivamente la carga de datos al personal (ver punto 4.1 sobre delegación a Leo).</Item>
              <Item><strong>Coordinación de la obra del nuevo invernadero</strong> (de ser necesario): seguimiento con albañiles y personal de montaje, dentro del horario presencial o con fecha y horario programado de antemano. No incluye atender entregas o tareas avisadas sobre la hora fuera del horario presencial.</Item>
              <Item><strong>Colaboración en control de stock de insumos</strong> (si Franco lo requiere): apoyar con el seguimiento una o dos veces al mes, o las que sean necesarias.</Item>
              <Item><strong>Coordinación de mantenimiento</strong> del vehículo de reparto y del grupo electrógeno: gestionar services, arreglos y contacto con el mecánico.</Item>
              <Item><strong>Coordinación y seguimiento</strong> de tareas de mantenimiento general.</Item>
            </ul>
          </Seccion>

          <Seccion n="3" titulo="Aporte como socio (fuera del horario presencial)">
            <p>Lo siguiente corre por fuera de la franja presencial y se aporta como socio, en la misma lógica en que los tres aportan su tiempo y dedicación:</p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              <Item>Recorridas, controles y chequeos por las tardes.</Item>
              <Item>Apertura, cierre y controles los sábados y domingos cuando corresponda.</Item>
              <Item>Disponibilidad razonable ante situaciones puntuales que requieran intervención.</Item>
              <Item>Comunicación con los socios: informar periódicamente avances, problemas relevantes y necesidades de inversión.</Item>
            </ul>
          </Seccion>

          <Seccion n="4" titulo="Gestión de equipo, delegación y evaluación">
            <p><strong>Equipo.</strong> El manejo del equipo en lo productivo es de Marcelo: define horarios, tareas, asignaciones y protocolos. Marcos se ocupa de sueldos y de lo administrativo.
            Premios y sanciones: los propone Marcelo y los ejecuta Marcos — Marcelo no discute plata con nadie. Si Marcos no coincide con algo propuesto, se lo dice a Marcelo, nunca al empleado directamente.</p>
            <p style={{ marginTop: '10px' }}><strong>Delegación a Leo.</strong> Es central y progresiva: la idea no es que Marcelo haga todo, sino que le vaya pasando cada vez más rutina a Leo —registros, controles diarios, mediciones, seguimiento de riego—, ya que las 4-5 horas presenciales no alcanzan para todo lo que abarca la descripción del puesto.
            Cuanta más ejecución quede en Leo, más tiempo le queda a Marcelo para planificación, calidad y mejora, que es donde el rol aporta más valor.
            Acordado <strong>sin plazo fijo</strong>: es un camino de mejora, no una fecha — el ritmo depende del criterio y las ganas que le ponga Leo, y eso no se puede garantizar de antemano (pueden ser tres meses o un año).</p>
          </Seccion>

          <Seccion n="5" titulo="Alcance de la responsabilidad sobre la producción">
            <p>El rol responde por las variables que están bajo control operativo:</p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              <Item>Control y manejo de la solución nutritiva y sus recetas.</Item>
              <Item>Aplicaciones foliares, controles sanitarios y de insectos.</Item>
              <Item>Manejo de tiempos de ciclo, trasplantes y siembras escalonadas.</Item>
              <Item>Manejo del riego con las herramientas disponibles.</Item>
            </ul>
            <p style={{ marginTop: '10px' }}>
              No es responsabilidad de Marcelo la baja de productividad originada en factores climáticos que la infraestructura
              actual no permite controlar —temperatura, humedad relativa, radiación y temperatura del agua de riego—. Ante
              situaciones extremas (semanas de calor intenso o inviernos rigurosos) se trabaja con las herramientas
              disponibles —ajuste de períodos de riego, manejo de conductividad eléctrica, colocar o sacar media sombra—,
              sabiendo que mitigan pero no resuelven el problema al 100%. Superar ese techo depende de futuras inversiones
              en automatización, no de la gestión operativa. Tampoco es su responsabilidad la falta de insumos necesarios
              para la producción que impida cumplir en tiempo y forma con las tareas diarias.
            </p>
            <p style={{ marginTop: '10px' }}>
              <strong>Cámara / mercadería (aclarado en la respuesta final de Marcelo — el control de stock de mercadería
              es de Juan, no de Franco, como decía el borrador inicial):</strong> Marcelo se hace responsable de lo que
              depende de él sobre el estado del producto en cámara — ordenar por antigüedad (FIFO), separar lo que ya no
              sirve, y marcar un límite de días para descartar. El <em>orden de salida</em> y que la mercadería <em>se
              venda a tiempo</em> es responsabilidad de Ventas: si la venta se demora y queda remanente que se deteriora
              esperando salir, ese deterioro no es gestión de Marcelo.
            </p>
          </Seccion>

          <Seccion n="6" titulo="Lo que NO forma parte del rol">
            <p>Para evitar malos entendidos, queda expresamente fuera del alcance:</p>
            <ul style={{ margin: 0, paddingLeft: '18px', color: '#991b1b' }}>
              <Item>Garantizar que nunca haya pérdidas de cultivos (por los motivos climáticos explicados en el punto 5).</Item>
              <Item>Ser responsable por cortes de energía.</Item>
              <Item>Ser responsable por fallas hidráulicas, eléctricas, mecánicas o estructurales no derivadas de una mala gestión operativa.</Item>
              <Item>Aprobar inversiones importantes.</Item>
              <Item>Resolver problemas financieros o comerciales de la empresa.</Item>
              <Item>Negociar o resolver con el personal cuestiones de sueldos, aumentos, premios o sanciones (los propone, no los ejecuta ni los discute en plata — ver punto 4).</Item>
              <Item>Control de stock de mercadería en cámara (es de Juan).</Item>
              <Item>Responsabilidad por el orden de salida, la demora en la venta, o el deterioro que resulte de esa demora (es de Ventas — ver punto 5).</Item>
              <Item>Estar disponible las 24 horas, todos los días del año.</Item>
            </ul>
          </Seccion>

          <Seccion n="7" titulo="Compensación e indicadores de gestión">
            <p>
              <strong>El sueldo no está atado a los indicadores.</strong> No hay bono, no hay descuento, nada de plata
              atado a ningún número. El sueldo es por el rol, que ya viene funcionando. Los indicadores son para tomar
              decisiones de gestión, no para evaluar a la persona.
            </p>
            <p style={{ margin: '10px 0 6px' }}>Marcelo es el primero de los cuatro socios en tener indicadores formales de seguimiento — los 3 acordados:</p>
            <ol style={{ margin: 0, paddingLeft: '18px' }}>
              <Item>
                <strong>Ocupación de posiciones — objetivo 95% promedio mensual, abierto por cultivo.</strong> Se mide
                como promedio del mes (no una foto puntual), para que contemple los huecos entre cosecha y trasplante.
                Marcelo aceptó el objetivo condicionado a resolver antes algunas mejoras pendientes en plantinera.
              </Item>
              <Item>
                <strong>Eficiencia Siembra → Cosecha</strong> (ajustado por Marcelo respecto de la propuesta inicial de
                "unidades vendidas / sembradas"): % de plantines que llegan vivos a cosecha sobre lo sembrado, medido a
                partir del descarte en las 3 etapas bajo su gestión (Plantín→F1, F1→F2, F2→Cosecha) — explícitamente
                <strong> separado de ventas y cámara</strong>, ya que lo que pasa con el producto después de cosechado
                no depende de él (ver punto 5). <em>Sin objetivo numérico fijado todavía</em> — se hace seguimiento del
                número mes a mes.
              </Item>
              <Item>
                <strong>Productividad — plantas cosechadas al mes por hora-persona total.</strong> <em>Sin objetivo por
                ahora</em>: se está midiendo. Con 6 a 8 mediciones en semanas distintas se fija el número, contra el
                propio baseline del equipo (no contra un número externo). <strong>Pendiente de definir</strong> (abierto,
                no resuelto en el intercambio de mails): si se cuenta solo el corte o corte + empaque, y si se separa
                lechuga de rúcula.
              </Item>
            </ol>
          </Seccion>

          <Seccion n="8" titulo="Objetivos en desarrollo">
            <p>Camino de mejora, algunos puntos ya en marcha:</p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              <Item>Indicadores de gestión: tiempos de ciclo, rendimiento por nave, pérdidas y ocupación de mesadas.</Item>
              <Item>Análisis de datos a partir de los registros que ya se cargan en la app.</Item>
              <Item>Investigación de variedades, fertilización, manejo climático y automatización del sistema.</Item>
              <Item>Investigación y desarrollo de procesos para mejorar la productividad en cosecha y empaquetado.</Item>
            </ul>
          </Seccion>

          <Seccion n="9" titulo="Ya implementado">
            <p>El rol ya viene funcionando. A la fecha se implementó, entre otras mejoras:</p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              <Item>Colaboración con Marcos en implementación de la app y desarrollo de la sección de Producción dentro de ella.</Item>
              <Item>Desarrollo de app para cálculos y registros de fertirriegos.</Item>
              <Item>Colaboración y coordinación con Ing. Juan Martín en desarrollo de sistema de alarma para detección de problemas hidráulicos y/o eléctricos en el circuito de la Nave 2.</Item>
              <Item>Cámara de germinación (reconversión de la cámara vieja), con mejora en la germinación.</Item>
              <Item>Coordinación constante con tareas de mantenimiento general.</Item>
              <Item>Mejora en la producción, más constante y pareja.</Item>
            </ul>
          </Seccion>

          <div style={{ marginTop: '4px', paddingTop: '14px', borderTop: '1px solid #f3f4f6' }}>
            <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>
              Los indicadores 1 y 2 se calculan automáticamente a partir de los registros de la app y se muestran en{' '}
              <Link href="/estadisticas#indicadores-marce" style={{ color: '#6b7280', fontWeight: 600 }}>Estadísticas → Indicadores Operativos Marce</Link>.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
