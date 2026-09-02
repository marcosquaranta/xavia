export type Rol = 'admin' | 'usuario';
export type Fase = 'plantin' | 'fase_1' | 'fase_2';
export type EstadoLote = 'activo' | 'cosechado' | 'descartado' | 'borrado';
export type TipoMovimiento = 'siembra' | 'trasplante' | 'cosecha' | 'descarte' | 'division';
export type NivelAlerta = '' | 'verde' | 'amarillo' | 'rojo';
export type DestinoCosecha = 'planta' | 'paquete' | 'bandeja' | 'cajon';

export interface Usuario {
  email: string; password_hash: string; rol: Rol; nombre: string;
  activo: 'SI' | 'NO'; fecha_alta: string;
}
export interface UsuarioPublico { email: string; rol: Rol; nombre: string; }

export interface Lote {
  id_lote: string; variedad: string; fecha_siembra: string;
  plantines_iniciales: number; fase_actual: Fase; ubicacion_actual: string;
  tubos_ocupados_actual: number | ''; plantas_estimadas_actual: number | '';
  fecha_ult_movimiento: string; fecha_f1: string; fecha_f2: string; fecha_cosecha: string;
  dias_plantinera: number | ''; dias_f1: number | ''; dias_f2: number | ''; dias_total: number | '';
  unidades_cosechadas: number | ''; plantas_por_unidad_real: number | '';
  descarte_reportado: number | ''; peso_muestra_kg: number | '';
  peso_total_estimado_kg: number | ''; usuario_creador: string;
  foto_url: string; lote_origen: string; semilla_id: string;
  destino_cosecha: DestinoCosecha | ''; notas: string; estado: EstadoLote;
  cajones_armados: number | '';
  peso_muestra_paquete_gr: number | '';
}

export interface Movimiento {
  id_movimiento: number; id_lote: string; fecha: string;
  tipo: TipoMovimiento; fase_origen: Fase | ''; fase_destino: Fase | '';
  ubicacion_origen: string; ubicacion_destino: string;
  tubos_ocupados: number | ''; plantas_estimadas: number | '';
  unidades_cosechadas: number | ''; plantas_por_unidad_real: number | '';
  tubos_consumidos_bandejas: number | ''; bandejas_armadas: number | '';
  descarte_reportado: number | ''; descarte_calculado: number | '';
  desvio_porcentaje: number | ''; nivel_alerta: NivelAlerta;
  alerta_revisada: 'SI' | 'NO' | ''; alerta_comentario: string;
  cosechador: string; usuario: string; foto_url: string; notas: string;
}

export interface Variedad {
  variedad: string; fases_aplicables: string; dias_estimados_cosecha: number;
  unidad_venta: 'planta' | 'paquete'; plantas_por_unidad_esperado: number;
  imagen_url: string; activo: 'SI' | 'NO';
}

export interface Ubicacion {
  id_ubicacion: string; nave: number; tipo: 'plantinera' | 'mesada';
  nombre: string; sector_fase: Fase; variedad_asignada: 'lechuga' | 'rucula' | 'mixta' | 'albahaca';
  modulos: number; perfiles_por_modulo: number; orificios_por_perfil: number;
  capacidad_calculada: number; metros_cuadrados: number;
  orden_visual: number; activo: 'SI' | 'NO'; notas: string;
}

export interface Semilla {
  id_semilla: string; batch: string; variedad: string; proveedor: string;
  fecha_recepcion: string; cantidad_recibida: number; unidad: string;
  precio_total: number | ''; stock_estimado: string; activo: 'SI' | 'NO'; notas: string;
}

export interface ConfigItem { clave: string; valor: string | number; descripcion: string; }

export interface Cliente {
  id_cliente: string; nombre: string; tipo: string; contacto: string;
  telefono: string; direccion: string; notas: string;
  activo: 'SI' | 'NO'; fecha_alta: string;
}

export interface Articulo {
  id_articulo: string;
  categoria: string;
  articulo: string;
  unidad_medida: string;
  activo: string;
  formula_uso: string;   // clave de DriverKey (ver lib/usoTeorico.ts), vacío = sin fórmula configurada
  factor_uso: number | string;  // uso teórico = driver(formula_uso) × factor_uso
}

export interface StockMes {
  id_stock: string;
  id_articulo: string;
  categoria: string;
  articulo: string;
  unidad_medida: string;
  anio: number | string;
  mes: number | string;
  stock_inicial: number | string;
  compras: number | string;
  stock_final: number | string;
  uso_calculado: number | string;
  precio_unitario: number | string;  // precio de la última compra registrada de ese artículo, para valorizar stock final
  notas: string;
  usuario: string;
  fecha_carga: string;
}

// Las categorías son las líneas del EERR: cada una cae en costo variable, en costo fijo o
// afuera del resultado. Fletes y Energía + Agua son COSTO VARIABLE aunque se carguen como
// gasto y no pasen por Stocks — el cierre las toma de acá y NO de la planilla de stock, para
// no contarlas dos veces si además existiera un artículo de esa categoría.
export type CategoriaGasto =
  | 'insumos' | 'gastos_generales' | 'sueldos' | 'mantenimiento'
  | 'inversion_equipamiento' | 'inversion_nave3' | 'abonos' | 'impuestos'
  | 'alquiler' | 'staff' | 'fletes_combustible' | 'energia_agua' | 'cultivos_reventa'
  | 'otros_ingresos' | 'movimiento_interno';
export const CATEGORIAS_GASTO: { value: CategoriaGasto; label: string }[] = [
  { value: 'gastos_generales', label: 'Gastos generales' },
  { value: 'insumos', label: 'Insumos' },
  { value: 'fletes_combustible', label: 'Fletes y combustible' },
  { value: 'energia_agua', label: 'Energía y agua' },
  { value: 'cultivos_reventa', label: 'Cultivos de reventa' },
  { value: 'sueldos', label: 'Sueldos' },
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'alquiler', label: 'Alquiler' },
  { value: 'staff', label: 'Staff (contador, marketing, asesoramiento)' },
  { value: 'inversion_equipamiento', label: 'Inversión en equipamiento' },
  { value: 'inversion_nave3', label: 'Inversión 3ra Nave' },
  { value: 'abonos', label: 'Abonos' },
  { value: 'impuestos', label: 'Impuestos' },
  { value: 'otros_ingresos', label: 'Otros ingresos (FCI, intereses)' },
  { value: 'movimiento_interno', label: 'Movimiento entre medios de pago (no es gasto)' },
];

// 'VISA' registra el CONSUMO con tarjeta, con la fecha en que se consumió. El pago del
// resumen a fin de mes NO es un gasto nuevo: es plata que va del banco a la tarjeta, y va
// cargado con categoría 'movimiento_interno'. Si se cargara como gasto, cada compra con
// tarjeta contaría dos veces en el resultado del mes.
// 'Aporte socios' es financiamiento, no costo: entra al flujo de fondos, nunca al resultado.
export type MedioPagoGasto = 'Brubank' | 'Macro' | 'VISA' | 'Caja MQ' | 'Caja FL' | 'Caja Marce' | 'Caja JP' | 'Aporte socios';
export const MEDIOS_PAGO: MedioPagoGasto[] = ['Brubank', 'Macro', 'VISA', 'Caja MQ', 'Caja FL', 'Caja Marce', 'Caja JP', 'Aporte socios'];
export interface Gasto {
  id_gasto: string;
  fecha: string;
  descripcion: string;
  categoria: CategoriaGasto;
  monto: number | string;
  medio_pago: MedioPagoGasto | string;
  usuario: string;
  fecha_carga: string;
  aplicado_stock: 'SI' | 'NO' | '';  // 'SI' = ya confirmado (o descartado) como compra de Stocks, no debe volver a sugerirse
  id_articulo: string;   // artículo vinculado directo (si se cargó como insumo detallado) — vacío si no aplica
  cantidad: number | string;  // cantidad física comprada — junto con monto define el precio unitario (monto/cantidad)
}

export interface ClienteVenta {
  id_control: string;
  nombre_xubio: string;
  nombre_display: string;
  alias: string;
  tipo_factura: string;
  punto_venta: string;
  sucursales: string;  // separadas por |
  activo: string;
  unidad: 'paq' | 'kg' | '';  // 'kg' para clientes que compran por KG (cajón)
  email: string;  // para enviarle el detalle de venta cuando es Factura B
  // Orden manual en la carga de Ventas — más bajo aparece primero. Vacío/0 = sin orden
  // fijado, el cliente cae al final ordenado por frecuencia de compra (comportamiento
  // de siempre). Ver mkFilas() en app/ventas/VentasManager.tsx.
  orden: number | string;
  // 'SI' = emitir una factura A XUBIO SEPARADA por cada sucursal (misma razón social,
  // comprobantes distintos) en vez de una sola factura combinada con todas las
  // sucursales adentro — para clientes tipo "La Esperanza" que piden un comprobante por
  // sucursal aunque compartan CUIT. '' o 'NO' = comportamiento de siempre (combinado).
  // Ver emitirPendientes() en lib/facturacionEmitir.ts.
  facturar_por_sucursal: 'SI' | 'NO' | '';
}

// Pedido recurrente de un cliente para un día fijo de la semana (0=domingo..6=sábado,
// igual que Date.getDay()) — se usa para pre-cargar la carga de Ventas de ese día,
// sin pisar nada si ya hay algo cargado.
export interface PedidoFijo {
  id_pedido_fijo: string;
  id_control: string;
  nombre_cliente: string;
  sucursal: string;
  dia_semana: number | string;
  rucula: number | string;
  lechuga_crespa: number | string;
  hoja_roble: number | string;
  bandeja_rucula: number | string;
  albahaca: number | string;
  activo: 'SI' | 'NO';
  notas: string;
}

export interface PrecioVenta {
  id_control: string;
  nombre_cliente: string;
  sucursal_obs: string;  // sucursal o nombre cliente si sin sucursales
  rucula: string;
  lechuga_crespa: string;
  hoja_roble: string;
  bandeja_rucula: string;
  albahaca: string;
  rucula_kg: string;   // precio por KG de rúcula (para clientes unidad=kg)
  lechuga_kg: string;  // LEGACY — precio por KG de lechuga sin distinguir variedad. Ya no se
                        // edita desde el admin (ver KG_LABELS en ClientesVentaManager); se
                        // mantiene solo para no perder el valor de clientes cargados antes del
                        // split. Los precios nuevos van en lechuga_kg_crespa/lechuga_kg_roble.
  lechuga_kg_crespa: string;
  lechuga_kg_roble: string;
}

export interface VentaDia {
  id_venta: string;
  fecha: string;
  id_control: string;
  nombre_cliente: string;
  sucursal: string;
  rucula: string;
  lechuga_crespa: string;
  hoja_roble: string;
  bandeja_rucula: string;
  albahaca: string;
  rucula_kg: string;
  lechuga_kg: string;  // LEGACY — ver comentario en PrecioVenta. Las cargas nuevas usan
                        // lechuga_kg_crespa/lechuga_kg_roble; esta columna sigue existiendo
                        // solo para no perder las ventas por kg cargadas antes del split.
  exportado: string;
  usuario: string;
  fecha_carga: string;
  lechuga_kg_crespa: string;
  lechuga_kg_roble: string;
}

export interface ConfigItem {
  clave: string;
  valor: string | number;
}

// Totales mensuales de venta previos a llevar el detalle día a día en Xavia (o meses
// incompletos) — en paquete/planta-equivalente, ya convertido. Pisan el cálculo real
// para ese mes en la evolución por artículo.
export interface VentaHistorica {
  mes: string;   // YYYY-MM
  rucula: string;
  lechuga: string;
}

// Movimiento de cajones plásticos reutilizables: se entregan con la mercadería y hay que
// recuperarlos — cada fila es UN evento (una entrega o una devolución puntual), el saldo
// por cliente se calcula sumando (ver lib/cajones.ts).
export interface CajonMovimiento {
  id_movimiento: string;
  fecha: string;
  id_control: string;
  nombre_cliente: string;
  // 'ajuste' = corrección manual del saldo en la calle a partir de un conteo físico —
  // a diferencia de 'entrega'/'devolucion' (que suman/restan), acá `cantidad` es el
  // saldo TOTAL contado (absoluto, mismo criterio que StockCamara.cantidad_paq), no un
  // delta. La diferencia contra el saldo teórico de ese momento queda registrada en
  // diferencia_paq — negativa = cajones perdidos, positiva = aparecieron de más.
  tipo: 'entrega' | 'devolucion' | 'ajuste';
  cantidad: number | string;
  usuario: string;
  notas: string;
  diferencia_paq: number | string;
}

// Lectura puntual del odómetro de un vehículo (km TOTALES acumulados, no el recorrido de
// la semana) — cada fila es UNA lectura en una fecha; el km recorrido por semana se
// calcula como la diferencia entre lecturas consecutivas (ver lib/kilometraje.ts).
export interface KilometrajeVehiculo {
  id_km: string;
  fecha: string;
  vehiculo: string;
  km_acumulado: number | string;
  notas: string;
  usuario: string;
}

// Caché diaria de horas-hombre reales (CrossChex), cargada por el cron
// /api/cron/productividad-diaria — CrossChex limita a 1 pedido cada 15 segundos, así que
// pedirle en vivo varios meses de fichajes en cada carga del Panel/Estadísticas (como se
// hacía antes) satura la API y deja el indicador de Productividad vacío. El cron trae solo
// "ayer" una vez por día (2-3 pedidos, entra cómodo en el límite) y lo deja acá; Panel y
// Estadísticas suman estas filas en vez de llamar a CrossChex directo.
export interface ProductividadDiaria {
  fecha: string; // YYYY-MM-DD
  horas_hombre: number | string;
  actualizado: string; // ISO — cuándo se cargó/actualizó esta fila
}

export interface StockCamara {
  id_registro: string;
  // 'lechuga' queda solo por compatibilidad con registros viejos (antes del split
  // crespa/roble) — los nuevos conteos van directo a 'lechuga_crespa'/'lechuga_roble'.
  cultivo: 'rucula' | 'lechuga' | 'lechuga_crespa' | 'lechuga_roble' | 'albahaca';
  fecha: string;
  tipo: 'inicial' | 'ajuste';
  cantidad_paq: number | string;
  notas: string;
  usuario: string;
  fecha_carga: string;
  // Momento REAL de carga (ms desde epoch, Date.now()) — a diferencia de fecha_carga
  // (solo fecha), esto permite saber si el conteo se cargó antes o después del mediodía
  // el mismo día en que se registró, para las entregas (8-12hs) del día en curso. Vacío
  // en registros viejos, de antes de este campo — ver lib/camara.ts::momentoDeRegistro.
  momento_carga: number | string;
  // Cuánto de la diferencia de este ajuste es descarte EN CÁMARA explícito (producto que
  // se tira al hacer el conteo — podrido, pasado, etc.), en paquetes — opcional, se carga
  // junto con el ajuste. Alimenta "Descarte por fase" en Estadísticas como una etapa más
  // (además de Plantín→F1, F1→F2, F2→Cosecha). No se suma al indicador "Eficiencia
  // Siembra → Cosecha" de los KPIs operativos de Marcelo — ese queda explícitamente
  // acotado a producción (siembra→cosecha), sin cámara ni ventas.
  descarte_paq: number | string;
}

// Configuración por empleado para Control de personal (horas/CrossChex) — workno es el
// número de legajo tal cual figura en CrossChex, para cruzar los fichajes.
export interface Empleado {
  workno: string;
  nombre: string;
  sueldo_hora: number | string;
  horas_teoricas_quincena: number | string; // manual — solo se usa si horas_lv está vacío/0 (fallback)
  horas_lv: number | string;      // horas por día, lunes a viernes — si está cargado, las horas
                                   // teóricas de la quincena se calculan solas según el calendario
  horas_sabado: number | string;  // horas por sábado (horario diferenciado) — 0/vacío = no trabaja sábados
  presentismo: number | string; // monto fijo — se pierde por falta o por 2+ tardanzas en la quincena
  hora_entrada_esperada: string; // "08:00" — lunes a viernes
  hora_entrada_esperada_sabado: string; // "09:00" — vacío = usa la de lunes a viernes
  hora_salida_esperada: string;  // "17:00"
  activo: 'SI' | 'NO';
}

// Ajustes puntuales por empleado + quincena (no son atributos permanentes del empleado,
// se cargan quincena a quincena): si cumplió presentismo a mano, un extra $ suelto, y
// horas extra a pagar por fuera de las teóricas.
export interface PersonalQuincena {
  id: string; // `${workno}-${anio}-${mes}-${quincena}`
  workno: string;
  anio: number | string;
  mes: number | string;
  quincena: number | string;
  presentismo_manual: 'SI' | 'NO' | '';
  extras: number | string;
  horas_extras: number | string;
}
