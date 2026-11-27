# Validación de entregas — diseño acordado (27-nov-2026)

Decidido con Marcos. **Todavía no está construido**: esto es el plan para ejecutar.
Bocetos de las pantallas: https://claude.ai/artifact/BPi3SWFTeE7K1Ev4EprPft

## El problema

Hoy la factura sale **antes** de que la mercadería se mueva, así que el comprobante dice
lo que pensábamos entregar, no lo que se entregó. Cada diferencia termina en una nota de
crédito. La NC es el parche; lo que hay que sacar es el motivo.

El orden correcto es el de cualquier reparto: primero se entrega, después se factura. De
hecho hoy está invertido también en el remito, que se genera *desde* la factura
(`lib/remitos.ts`).

## Las respuestas de Marcos

- **Entre la carga y la entrega pasan como mucho 24 h.** A veces se carga a la tarde y se
  entrega al otro día. Por eso la factura lleva la **fecha de la entrega**, no la de la
  validación, y el barrido automático corre al día siguiente.
- **Ningún cliente necesita la factura en mano**, salvo **La Gallega**, que necesita que la
  factura se emita en el momento en que se hace el remito. Esa queda como hoy: se factura
  al cargar, sin esperar validación.
- Los remitos a veces se hacen escritos a mano. No los toca este cambio.
- **Rol `reparto` nuevo**, que ve solo esta pantalla.
- Guardar **apenas confirma cada cliente**, no todo junto al final.
- **Facturación e Historial tienen que cambiar lo menos posible.** Es la restricción más
  fuerte del diseño: son pantallas que ya se usan todos los días y que acaban de recibir el
  freno de duplicados y el acuse.

## Las dos etapas — y por qué la primera NO frena ninguna factura

Corrección de Marcos (27-nov, después del primer boceto): *"si el repartidor empieza no
usándolo, que no me genere problema; que mientras aprendo a usarlo las facturas se sigan
emitiendo solas"*. El diseño original tenía el default al revés: la factura esperaba la
validación, así que el primer día que el repartidor no abriera la pantalla, **todas** las
facturas se atrasaban 24 h. Es un costo de iniciación alto y un problema con el cliente,
por una herramienta que todavía nadie sabe usar.

### Etapa 1 — la pantalla avisa, no bloquea (así se lanza)

Todo sigue **exactamente** como hoy: la venta se carga y la factura sale en ese momento.
La pantalla del repartidor existe, y lo que confirma no frena nada: genera la diferencia,
el mail a Juan Pablo, el movimiento de cajones y **la nota de crédito ya armada, lista para
aprobar** (que hoy se hace entera a mano).

- Si el repartidor no la usa: no pasa nada, cero cambio respecto de hoy.
- Si la usa a medias: esos clientes tienen la NC lista en vez de hecha a mano.
- El valor aparece desde el primer día sin depender de que la adopción sea completa.

Es además la única forma honesta de saber si la idea sirve: en unas semanas el mail de
diferencias dice **cuánto** se está corrigiendo y **en qué clientes**, con datos y no con
impresiones.

### Etapa 2 — la factura espera la validación (cliente por cliente)

Cuando el reparto ya lo usa todos los días, se da vuelta con una marca por cliente
(`espera_validacion` en Clientes). Se empieza por **dos o tres**, los que más NC generan, no
por todos. Ahí recién desaparecen las notas de crédito.

Mientras un cliente no tenga la marca, se comporta como la etapa 1. La marca es el único
interruptor y se vuelve atrás en un minuto.

## Cuándo sale la factura a Xubio

**Todo esto es de la etapa 2.** En la etapa 1 la factura sale al cargar, como hoy.

**En el momento en que el repartidor confirma el cliente.** No se juntan, no hay cola nueva,
no hay una hora fija a la que "sale todo".

El motivo es la restricción de arriba: hoy la carga ya factura cliente por cliente
(`/api/ventas/cargar` con `soloCliente`, que existe justamente para eso). Si la validación
emite por ese mismo camino, Facturación y el Historial ven exactamente lo que ven hoy —una
venta que pasa de borrador a facturada— y el único cambio es **quién** apretó y **cuándo**.
Juntar las facturas para emitirlas a una hora fija obligaría a una cola nueva, un estado
nuevo visible y un cron de emisión: tres cosas que esas pantallas tendrían que aprender.

Dos excepciones, las dos ya decididas:

1. **La Gallega**: se factura al cargar, como hoy.
2. **Barrido de las que nadie confirmó**: un cron diario al mediodía (hora argentina) emite
   todo lo cargado con fecha de ayer o anterior que siga sin validar, tal como se cargó.
   Queda marcado como `auto`, que **no es lo mismo que validado**: nadie dijo que eso se
   entregó, solo pasaron 24 h. El mail a Juan Pablo las lista aparte por eso.

## Los datos

### Hoja `Ventas` — no cambia de forma

Cuando se valida, **la fila de Ventas se actualiza con lo entregado**. Es la decisión
importante: todo lo que lee ventas (estadísticas, reporte semanal, cámara, cobranzas,
facturación) sigue leyendo una sola cosa, la verdad, sin enterarse de que existe esto.

### Hoja `Entregas` — nueva

Una fila por `fecha + id_control + sucursal`. Es donde vive la evidencia:

| columna | qué es |
|---|---|
| `id_entrega` | id propio |
| `fecha` | la de la entrega (la de la venta) |
| `id_control`, `sucursal` | a quién |
| `estado` | `pendiente` · `validada` · `auto` |
| `validado_por`, `validado_en` | quién confirmó y a qué hora |
| `pedido_json` | **lo que se había cargado**, congelado al crear la fila |
| `entregado_json` | lo que dijo el repartidor |
| `cajones_devueltos` | cuántos volvieron |
| `nota` | texto libre del repartidor (opcional) |

**Nunca se pisa `pedido_json`.** Sin eso no hay mail de diferencias, no se puede saber si un
pedido fijo quedó viejo, y no queda rastro de nada.

El estado "esperando validación" no necesita columna nueva en Ventas: es *hay fila en
Entregas con estado `pendiente` y la venta sin exportar*.

### Hoja `Clientes` — una columna

`factura_con_remito` (SI/NO). Hoy la usa solo La Gallega. Editable desde
Admin → Clientes de venta.

## Las pantallas

### Reparto (celular, rol `reparto`)

1. **Lista del día**: progreso (3 de 7), una tarjeta por cliente con sucursal, resumen de
   cantidades y estado. La siguiente destacada. Si en ese cliente hay que cobrar facturas
   viejas, se avisa ahí (reusar `lib/avisoCobroEntrega.ts`).
2. **Una entrega**: las cantidades precargadas con − y + de 46 px. Lo tocado queda en ámbar
   con "se habían cargado 12". Abajo: cajones devueltos, "dejé algo que no estaba en la
   lista", y el botón grande. El pie dice qué se va a facturar.
3. **Confirmada**: lo que queda facturado, los cambios marcados, y que se le avisó a Juan
   Pablo. Se puede volver a entrar a corregir **mientras la factura no haya salido**.

### Facturación / Historial (admin)

Lo mínimo:

- Una franja arriba: "N entregas de hoy esperando que el reparto confirme", con los nombres
  y un botón **Facturar igual**.
- En las filas confirmadas, la cantidad entregada y al lado en gris la que se había cargado.
- Nada más. Mismos botones, mismo orden, mismo acuse, mismo freno de duplicados.

### Mail a Juan Pablo (a la tarde, solo si hubo diferencias)

- Titular con la **plata**: "se facturaron $47.900 menos de lo que se había cargado".
- Tabla: cliente, producto, cargado, entregado, diferencia, $.
- **El patrón, no solo el día**: si un cliente viene recibiendo menos hace tres entregas, el
  pedido fijo quedó viejo y eso es lo que hay que arreglar. Es la parte que convierte el
  mail en algo que se acciona.
- Las `auto` aparte: "nadie confirmó estas, se facturaron solas".
- Destinatario por `lib/avisosConfig.ts` (clave nueva `email_diferencias_entrega`), no
  hardcodeado.

## Riesgos que el diseño tiene que seguir cubriendo

- **Que confirme sin mirar.** Si validar es trabajo extra sin beneficio, aprieta "confirmar"
  en el semáforo y quedan las mismas cantidades mal pero ahora firmadas — peor que hoy,
  porque nadie vuelve a revisar. Por eso la pantalla tiene que ser más rápida que no usarla,
  y por eso el cajón y el aviso de cobro van ahí: para que le sirva a él también.
- **"No cambió nada" y "nunca la abrió" no son lo mismo.** Son estados distintos
  (`validada` / `auto`) y se muestran distinto en todos lados.
- **Señal en la calle.** Se guarda por cliente apenas confirma, con reintento. Nunca una
  pantalla que se guarda entera al final.
- **Dos repartidores.** Por eso es un rol con usuario y no un link sin contraseña: hay que
  poder decir quién confirmó.

## Qué hay que tocar de lo ya construido

- `lib/alertasVentas.ts` y el cron `sin-facturar`: una venta esperando validación **no está
  sin facturar**. Si no entienden el estado nuevo, avisan todos los días por ventas que
  están perfectamente bien.
- `lib/duplicadosVenta.ts` y el freno de `/api/ventas/guardar`: el día que se valida se
  reescribe la fila; eso no puede leerse como una carga repetida.
- `lib/remitos.ts`: hoy el remito sale de la factura. Con este orden, la entrega validada es
  la fuente natural. No es urgente, pero conviene dejarlo anotado.

## La fila de `Entregas`, exacta

Las cantidades NO van como un diccionario por artículo, van como una lista de líneas, una
por **fila de Ventas**. El motivo es concreto: `LineaNC` (`lib/notaCredito.ts`) pide
`{ id_venta, key, cantidad }`, y una entrega de un cliente puede venir de varias filas. Si
se guarda agregado por artículo, después hay que adivinar de qué fila salió cada paquete y
la NC pre-armada no se puede construir sin inventar.

```jsonc
{
  "id_entrega": "ENT-20261127-0007",
  "fecha": "2026-11-27",              // la de la entrega = la de la venta
  "id_control": "12",
  "sucursal": "Uriburu",
  "estado": "validada",               // pendiente | validada | auto
  "validado_por": "diego@xavia.com.ar",
  "validado_en": "2026-11-27T14:42:11Z",
  "lineas": [
    { "id_venta": "V-8841", "key": "rucula",         "pedido": 24, "entregado": 24 },
    { "id_venta": "V-8841", "key": "lechuga_crespa", "pedido": 12, "entregado": 9  },
    { "id_venta": "V-8841", "key": "hoja_roble",     "pedido": 6,  "entregado": 6  }
  ],
  "cajones_devueltos": 8,
  "nota": "",
  "comprobante": "A-00002-00000881"   // la factura que ya había salido (etapa 1)
}
```

- `pedido` se escribe una vez y **no se vuelve a tocar nunca**.
- Las claves de artículo salen de `clavesDeVenta()`, no de una lista escrita acá: un
  artículo dado de alta en Admin tiene que aparecer solo.
- En la hoja, `lineas` va como JSON en una celda. Es un detalle feo pero es lo que hace que
  la hoja no tenga que crecer una columna por artículo cada vez que se da de alta uno.

**Cuándo nace la fila:** al confirmar, no antes. No hace falta ningún proceso que la cree:
la lista del día del repartidor se arma de las ventas de esa fecha, y una venta sin fila en
`Entregas` es una entrega sin confirmar. Un pre-armado nocturno sería una cosa más que se
puede desincronizar de la planilla sin que nadie se entere.

## Los endpoints

| método | ruta | quién | qué hace |
|---|---|---|---|
| GET | `/api/reparto/dia?fecha=` | `reparto` y `admin` | Las entregas de la fecha: cliente, sucursal, líneas con lo cargado, estado, cajones afuera y si hay que cobrar facturas viejas ahí. Una sola lectura. |
| POST | `/api/reparto/confirmar` | `reparto` y `admin` | `{ fecha, id_control, sucursal, lineas, cajones_devueltos, nota }`. Escribe la fila de `Entregas`, y el movimiento de cajones si hay devolución. Idempotente: confirmar dos veces el mismo cliente actualiza la fila, no crea otra. |
| GET | `/api/reparto/diferencias?desde=&hasta=` | `admin` | Lo que alimenta el mail y la franja de Facturación. Sin estado propio: se calcula de `Entregas`. |

El POST **no emite nada en la etapa 1**. La emisión por validación es el paso 6, y entra
como una rama dentro de ese mismo endpoint cuando el cliente tiene `espera_validacion`.

Los cajones no se escriben a mano: se reusa `/api/cajones/movimiento` con
`tipo: 'devolucion'`. Dos caminos que escriben la misma hoja terminan siendo dos criterios.

## Quién ve qué

El rol nuevo es `reparto` en `lib/types.ts` (`Rol = 'admin' | 'usuario' | 'reparto'`) y ve
**una sola pantalla**: `/reparto`. Todo lo demás —el menú entero— no aparece y las APIs lo
rechazan. Es un rol más chico que `usuario`, no una variante.

Lo que hay que revisar al agregarlo: todo lo que hoy pregunta `rol !== 'admin'` sigue
andando igual (reparto no es admin), pero lo que pregunta "está logueado" se abre de más.
Hay que ir una por una por las APIs que solo chequean `getCurrentUser()`.

**Dos repartidores:** en la etapa 1 los dos ven todas las entregas del día. No hay rutas
cargadas en ningún lado y inventarlas ahora es construir una tabla de datos que nadie
mantiene. Lo que importa queda registrado igual: `validado_por` dice quién confirmó cada
cliente. Si con el uso se pisan, ahí se agrega una ruta por repartidor, con el dato real de
cómo se reparten las entregas, que hoy no tenemos.

## Casos borde, resueltos

| situación | qué pasa |
|---|---|
| Entregó más de lo cargado | Se guarda igual y va al mail en verde: falta facturar esa diferencia. Es plata que hoy se regala. |
| Entregó un artículo que no estaba en la lista | Se agrega una línea sin `id_venta` y sin `pedido`. No crea una venta: cargar sigue siendo del admin. Va al mail. |
| No entregó nada en ese cliente | Confirma todo en cero. Es distinto de no confirmar, y el mail lo dice así. |
| Confirma dos veces | La segunda pisa la primera. `pedido` no se toca; `validado_en` sí. |
| Se equivocó y quiere corregir | Vuelve a entrar y confirma de nuevo, mientras la NC no esté aprobada (etapa 1) o la factura no haya salido (etapa 2). |
| Confirma un cliente de ayer | Se permite: a veces se confirma al volver al depósito. El mail del día siguiente lo muestra con su fecha real. |
| Confirma algo de hace dos semanas | No se permite. Más de 7 días atrás es otra conversación, no una corrección de reparto. |
| El cliente tiene dos sucursales | Una entrega por sucursal, siempre. Es la clave de la fila. |
| La Gallega | Igual que cualquiera en la pantalla del reparto. Lo que no cambia nunca es cuándo sale su factura. |
| Se queda sin señal | La confirmación queda en el celular y reintenta sola. Si al volver sigue sin subir, la pantalla lo dice en rojo: nunca se da por guardado algo que no se guardó. |
| El admin ya había hecho la NC a mano | La diferencia aparece igual, pero la NC pre-armada chequea contra las NC ya emitidas de esa factura y no propone acreditar dos veces lo mismo. |

## La nota de crédito pre-armada

No se emite nada solo. Lo que hace la app es dejar el botón cargado: la diferencia ya es
exactamente `LineaNC[]` (de ahí que las líneas guarden `id_venta`), y el número de factura
sale de `exportado` de esas mismas filas. En la pantalla de Historial, donde hoy se arma la
NC a mano eligiendo artículo por artículo, aparece precargada con "el reparto dijo que
entregó 3 crespas menos".

Aprobar sigue siendo un acto de un admin, y sigue siendo el mismo
`emitirNCDeFactura(...)`. Un comprobante fiscal que se emite solo porque alguien tocó un −
en un celular es exactamente lo que no queremos.

## Cómo se decide pasar a la etapa 2

No por impresión. Después de tres o cuatro semanas de etapa 1, el mail ya respondió:

- cuántas entregas por semana tienen diferencia, y de cuánta plata;
- en qué clientes se concentran;
- qué porcentaje de las entregas confirma el reparto (si es bajo, el problema es la
  pantalla o el acuerdo con el repartidor, y adelantar la etapa 2 lo empeora).

Si las diferencias se concentran en dos o tres clientes, probablemente el arreglo no sea la
etapa 2 sino corregirles el pedido fijo. Eso es gratis y sale primero.

## Qué se testea

Las funciones puras de `lib/entregas.ts`, que es donde está toda la lógica:

- comparar pedido contra entregado: igual, menos, más, artículo nuevo, todo en cero;
- agrupar varias filas de venta del mismo cliente y sucursal en una entrega;
- convertir una diferencia en `LineaNC[]`, descontando lo que ya tenga NC emitida;
- el estado de una entrega a partir de Ventas + Entregas (sin confirmar, validada, auto);
- el resumen del mail: totales en plata y la detección del patrón de varias semanas.

## El mail de diferencias, definido

- **Cuándo**: todos los días a las 19:00 de Argentina (22:00 UTC), después de que volvió el
  reparto. Un cron nuevo, `/api/cron/diferencias-entrega`.
- **A quién**: `email_diferencias_entrega` en `lib/avisosConfig.ts`, con Juan Pablo por
  defecto (su dirección ya está en el repo). Marcos lo agrega desde Admin → Avisos si quiere
  recibirlo.
- **Cuándo NO sale**: si no hubo ninguna diferencia. Un mail diario que dice "todo bien" se
  archiva sin abrir y se lleva puesto el día que trae algo.
- **El titular es la plata**, no la cantidad: "se facturaron $47.900 de más" o "de menos".
  Un titular que dice "3 diferencias" no distingue tres paquetes de treinta.

**Cómo se valoriza.** Con `getPrecio` del cliente, igual que la pantalla de ventas — y
**neto, sin IVA**, que es como valoriza toda la app. El mail lo dice en una línea al pie,
porque el importe de la factura que está al lado sí lleva IVA adentro y si no se aclara
parece que los números no cierran. Es el mismo problema que obligó a `mismoImporte()` en el
freno de duplicados.

**El patrón.** Es la parte que convierte el mail en algo que se acciona, y es una cuenta
simple: para cada cliente + artículo, mirar las últimas 4 entregas confirmadas; si en 3 o
más el entregado fue menor al pedido, se marca como pedido fijo viejo y se linkea directo a
Admin → Pedidos fijos de ese cliente. Menos de 3 de 4 no es un patrón, es una semana.

**Las `auto` van en su propio bloque**, nunca mezcladas con las confirmadas. "Nadie dijo
nada" no es "se entregó tal cual", y si se leen juntas, la mitad del mail dice algo que
nadie verificó.

## Lo que esta función NO hace

Escrito para no discutirlo de nuevo mañana a la mitad:

- No le pide firma al cliente, ni foto, ni ubicación. Es una herramienta para nosotros, no
  un control sobre el repartidor; el día que parezca un control, deja de usarse.
- No carga ventas nuevas. Cargar sigue siendo del admin.
- No toca stock ni cámara: la cámara se ajusta por conteo físico, no por lo que diga una
  entrega.
- No arma rutas ni asigna clientes a repartidores.
- No emite ni aprueba ninguna nota de crédito sola.
- No manda nada al cliente.

## El acceso del repartidor

- Un usuario en la hoja `Usuarios` con rol `reparto`, dado de alta como cualquiera.
- La sesión dura 7 días (`sessionOptions.maxAge`, ya es así), así que en la práctica se
  loguea una vez y se olvida. Hay que verificar que el celular no borre la cookie: si lo
  hace, hay que subir ese plazo **solo para este rol**, no para todos.
- Se accede por el navegador del celular, agregando `xavia-self.vercel.app/reparto` a la
  pantalla de inicio. No hay app que instalar ni nada que mantener.
- Si el celular es prestado o compartido, el usuario sigue siendo el de quien se logueó: por
  eso `validado_por` se guarda, pero se lee como "quién estaba logueado", no como una prueba.

## Offline, concreto

Lo que está en la calle es la confirmación, y es poca cosa: un objeto por cliente.

- Al confirmar, se guarda primero en el celular (`localStorage`) y se intenta mandar.
- Si falla, la tarjeta queda con un reloj ámbar: **"guardado en el celular, falta subirlo"**.
  Nunca se dice "listo" por algo que no se guardó: ese es el único bug acá que haría perder
  datos de verdad.
- Reintenta al reconectar y al volver a abrir la pantalla.
- Arriba, un contador: "2 sin subir". Si al final del día queda algo, se ve.
- Si dos personas confirman el mismo cliente al mismo tiempo, gana la última y la fila es
  una sola (la clave es fecha + cliente + sucursal, no la hora): la escritura busca la fila
  existente antes de agregar, igual que hace `guardar` con las ventas.

## La franja en Facturación e Historial

Un solo bloque, arriba de la tabla, y solo si hay algo:

> **2 entregas de hoy esperando que el reparto confirme** — Mamina (Newbery) · Heroica
> (Güemes)

En la etapa 1 es informativa y no tiene botón: las facturas ya salieron. En la etapa 2 suma
"Facturar igual". En las filas ya confirmadas con diferencia, la cantidad entregada y al
lado en gris la cargada. Nada más: ni columnas nuevas, ni filtros, ni pestañas.

## Dos cosas que hay que decir de entrada

1. **Al principio las notas de crédito pueden AUMENTAR.** Hoy hay diferencias que no
   terminan en NC porque nadie se entera: el cliente paga más de lo que recibió. Cuando el
   reparto empiece a confirmar, esas aparecen. No es que el sistema empeoró las cosas: es
   que se ven. Después bajan a cero con la etapa 2.
2. **Entregar de más también aparece**, y eso es plata que hoy se regala. Es la mitad del
   valor de esto y no estaba en la conversación original.

## Antes de dárselo al repartidor

Una semana usándolo vos o Juan Pablo al volver el camión, con lo que el repartidor cuente
por teléfono. Sirve para dos cosas: ver si el mail dice algo útil, y llegar con la pantalla
ya probada el día que se la mostrás a él — explicarle una herramienta que todavía falla es
la forma más rápida de que no la use más.

Y una alerta de salud: si pasan 5 días hábiles sin una sola confirmación, que avise. Si no,
esto se apaga en silencio y nos enteramos en tres meses.

## Qué se le dice al repartidor

Un párrafo, no un instructivo:

> Antes de arrancar, abrí esto en el celular. Tenés la lista de los clientes del día con lo
> que te cargamos. Si dejás lo mismo, tocás *Confirmar* y listo. Si dejaste menos o más,
> corregís el número y confirmás. Lo que anotes ahí es lo que se le factura al cliente, así
> que es la forma de que no te llamen después por algo que no dejaste. Aprovechá y cargá los
> cajones que te devuelven.

## Orden de ejecución sugerido

Los pasos 1 a 5 son la **etapa 1** y no cambian nada de lo que pasa hoy con las facturas.

1. Hoja `Entregas` + `lib/entregas.ts` (funciones puras: armar el día, comparar pedido vs
   entregado, calcular diferencias). Tests de la comparación.
2. Rol `reparto` en `lib/auth.ts` / `types.ts` y el filtro de navegación.
3. Pantalla `/reparto` (las tres vistas) + API de confirmar, que guarda la entrega. **No
   emite ni frena nada.**
4. Mail de diferencias a Juan Pablo + la NC pre-armada lista para aprobar.
5. Franja en Facturación e Historial (solo informativa).

Y después, con semanas de datos encima:

6. Marca `espera_validacion` por cliente, emisión al confirmar y cron de barrido al mediodía.
7. Ajustar las alertas de "sin facturar" y el freno de duplicados para el estado nuevo —
   recién hace falta acá, porque antes no existe ninguna venta esperando validación.
