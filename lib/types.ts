// Tipos de datos de XaviaApp
// Estos reflejan las columnas de cada pestaña del Google Sheet.

export type Rol = 'admin' | 'usuario';

export type Fase = 'plantin' | 'fase_1' | 'fase_2';

export type EstadoLote = 'activo' | 'cosechado' | 'descartado';

export type TipoMovimiento = 'siembra' | 'trasplante' | 'cosecha' | 'descarte';

export type NivelAlerta = '' | 'verde' | 'amarillo' | 'rojo';

export type DestinoCosecha = 'planta' | 'paquete' | 'bandeja';

// === USUARIOS ===
export interface Usuario {
  email: string;
  password_hash: string;
  rol: Rol;
  nombre: string;
  activo: 'SI' | 'NO';
  fecha_alta: string;
}

export interface UsuarioPublico {
  email: string;
  rol: Rol;
  nombre: string;
}

// === LOTES ===
export interface Lote {
  id_lote: string;
  variedad: string;
  fecha_siembra: string;
  plantines_iniciales: number;
  fase_actual: Fase;
  ubicacion_actual: string;
  tubos_ocupados_actual: number | '';
  plantas_estimadas_actual: number | '';
  fecha_ult_movimiento: string;
  fecha_cosecha: string;
  unidades_cosechadas: number | '';
  plantas_por_unidad_real: number | '';
  descarte_reportado: number | '';
  peso_muestra_kg: number | '';
  peso_total_estimado_kg: number | '';
  usuario_creador: string;
  foto_url: string;
  lote_origen: string;
  semilla_id: string;
  destino_cosecha: DestinoCosecha | '';
  notas: string;
  estado: EstadoLote;
}

// === MOVIMIENTOS ===
export interface Movimiento {
  id_movimiento: number;
  id_lote: string;
  fecha: string;
  tipo: TipoMovimiento;
  fase_origen: Fase | '';
  fase_destino: Fase | '';
  ubicacion_origen: string;
  ubicacion_destino: string;
  tubos_ocupados: number | '';
  plantas_estimadas: number | '';
  unidades_cosechadas: number | '';
  plantas_por_unidad_real: number | '';
  tubos_consumidos_bandejas: number | '';
  bandejas_armadas: number | '';
  descarte_reportado: number | '';
  descarte_calculado: number | '';
  desvio_porcentaje: number | '';
  nivel_alerta: NivelAlerta;
  alerta_revisada: 'SI' | 'NO' | '';
  alerta_comentario: string;
  cosechador: string;
  usuario: string;
  foto_url: string;
  notas: string;
}

// === VARIEDADES ===
export interface Variedad {
  variedad: string;
  fases_aplicables: string;
  dias_estimados_cosecha: number;
  unidad_venta: 'planta' | 'paquete';
  plantas_por_unidad_esperado: number;
  imagen_url: string;
  activo: 'SI' | 'NO';
}

// === UBICACIONES ===
export interface Ubicacion {
  id_ubicacion: string;
  nave: number;
  tipo: 'plantinera' | 'mesada';
  nombre: string;
  sector_fase: Fase;
  variedad_asignada: 'lechuga' | 'rucula' | 'mixta';
  modulos: number;
  perfiles_por_modulo: number;
  orificios_por_perfil: number;
  capacidad_calculada: number;
  metros_cuadrados: number;
  orden_visual: number;
  activo: 'SI' | 'NO';
  notas: string;
}

// === SEMILLAS ===
export interface Semilla {
  id_semilla: string;
  batch: string;
  variedad: string;
  proveedor: string;
  fecha_recepcion: string;
  cantidad_recibida: number;
  unidad: string;
  precio_total: number | '';
  stock_estimado: 'normal' | 'bajo' | 'agotada';
  activo: 'SI' | 'NO';
  notas: string;
}

// === CONFIGURACION ===
export interface ConfigItem {
  clave: string;
  valor: string | number;
  descripcion: string;
}

// === HISTORICO OCUPACION ===
export interface HistoricoOcupacion {
  fecha: string;
  id_ubicacion: string;
  plantas_vivas: number;
  capacidad: number;
  ocupacion_porcentaje: number;
  huecos_libres: number;
}

// === CLIENTES (fase 2) ===
export interface Cliente {
  id_cliente: string;
  nombre: string;
  tipo: string;
  contacto: string;
  telefono: string;
  direccion: string;
  notas: string;
  activo: 'SI' | 'NO';
  fecha_alta: string;
}

// === VENTAS (fase 2) ===
export interface Venta {
  id_venta: number;
  fecha_entrega: string;
  id_cliente: string;
  cliente_nombre: string;
  variedad: string;
  unidad: 'planta' | 'paquete' | 'bandeja';
  cantidad: number;
  precio_por_unidad: number;
  total: number;
  lotes_origen: string;
  usuario: string;
  notas: string;
}
