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
  nombre: string; sector_fase: Fase; variedad_asignada: 'lechuga' | 'rucula' | 'mixta';
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

export type CategoriaGasto = 'insumos' | 'gastos_generales' | 'sueldos' | 'mantenimiento' | 'inversion_equipamiento' | 'inversion_nave3' | 'abonos';
export const CATEGORIAS_GASTO: { value: CategoriaGasto; label: string }[] = [
  { value: 'gastos_generales', label: 'Gastos generales' },
  { value: 'insumos', label: 'Insumos' },
  { value: 'sueldos', label: 'Sueldos' },
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'inversion_equipamiento', label: 'Inversión en equipamiento' },
  { value: 'inversion_nave3', label: 'Inversión 3ra Nave' },
  { value: 'abonos', label: 'Abonos' },
];
export type MedioPagoGasto = 'Brubank' | 'Macro' | 'Caja MQ' | 'Caja FL' | 'Caja Marce' | 'Caja JP';
export const MEDIOS_PAGO: MedioPagoGasto[] = ['Brubank', 'Macro', 'Caja MQ', 'Caja FL', 'Caja Marce', 'Caja JP'];
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

export interface StockCamara {
  id_registro: string;
  // 'lechuga' queda solo por compatibilidad con registros viejos (antes del split
  // crespa/roble) — los nuevos conteos van directo a 'lechuga_crespa'/'lechuga_roble'.
  cultivo: 'rucula' | 'lechuga' | 'lechuga_crespa' | 'lechuga_roble';
  fecha: string;
  tipo: 'inicial' | 'ajuste';
  cantidad_paq: number | string;
  notas: string;
  usuario: string;
  fecha_carga: string;
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
  hora_entrada_esperada: string; // "08:00"
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
