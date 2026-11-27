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
