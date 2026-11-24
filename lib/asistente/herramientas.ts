import type Anthropic from '@anthropic-ai/sdk';
import { horasDeJornada } from '../personal';
import { Planillas } from './datos';
import type { Rol } from '../types';
import { MEDIOS_PAGO } from '../types';
import { sumarDias } from '../recordatoriosCobro';
import { calcularEERR, previsionesSugeridas } from '../eerr';
import { calcularValorizacionMes } from '../valorizacionStock';
import { leerPrevisiones, previsionDelMes } from '../previsiones';
import { leerCobranzas, leerSaldos, saldosDelMes, movimientosDeCuenta, type Cobranza, type SaldoCuenta } from '../cuentas';
import {
  HOJA_COBRANZAS_CACHE, HOJA_COMPROBANTES, comprobantesDesdeCache, cobranzasDesdeCache,
  type CobranzaCache, type ComprobanteCache,
} from '../xubioCache';
import { facturasPorCliente, diagnosticoReparto } from '../facturasCliente';
import { leerSaldadas, numerosSaldados } from '../facturasSaldadas';
import { leerEdiciones, imputacionesManuales } from '../cobranzasEdit';
import { leerAjustes, ajustesPorFactura } from '../ajusteFactura';
import { correccionesPorFactura } from '../correccionesFactura';
import { leerNotas } from '../notaCredito';
import { claveComprobante } from '../comprobantes';
import { nombreClienteVisible } from '../clientes';
import { HOJA_COBROS, type CobroRegistrado } from '../cobros';
import { calcularCapacidad, diasCicloDefault } from '../planificacionServer';
import { calcularPlan, parseReparto, REPARTO_DEFAULT, tareasDelDia, siembraDelDia, planchasSiembra, MARGEN_SIEMBRA } from '../planificacion';
import { CATEGORIAS_GASTO } from '../types';

// ── Las herramientas del asistente ────────────────────────────────────────────────────
//
// El asistente NO ve la planilla. Ve estas funciones, y solo puede contestar con lo que
// devuelven. Son las mismas que calculan las pantallas, así que el número del chat y el de
// la pantalla no se pueden contradecir — que es el problema que volvió tres veces en esta
// app: dos caminos distintos para el mismo dato terminan siendo dos verdades.
//
// ── SOBRE LOS PERMISOS, que es lo importante de este archivo ──
//
// `soloAdmin` NO es una sugerencia para el modelo: las herramientas marcadas así se filtran
// ANTES de armar el pedido, así que un usuario que no es admin trabaja con un modelo que no
// sabe que existen. No hay nada que convencer ni ningún prompt que saltearse.
//
// Escribirlo como instrucción en el prompt ("no le muestres sueldos a los operarios") sería
// un cartel, no una puerta: alcanza con que alguien insista para que el modelo lo
// reconsidere. Un control de acceso que depende de que el modelo obedezca no es un control
// de acceso.
//
// Todo lo que toque plata —resultado, sueldos, deuda, saldos, precios, previsiones— es solo
// admin. Lo operativo —tareas, siembra, lotes, cantidades de stock— lo ve todo el mundo,
// porque es lo que necesitan para trabajar.

export interface Herramienta {
  nombre: string;
  descripcion: string;
  schema: Record<string, any>;
  soloAdmin: boolean;
  ejecutar: (args: any, ctx: Contexto) => Promise<any>;
}

export interface Contexto {
  p: Planillas;
  rol: Rol;
  hoy: string;
}

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const $ = (n: number) => Math.round(n);

// Año y mes por defecto: el último mes CERRADO, igual que la pantalla de cierre. Preguntar
// "cómo venimos" en el mes en curso devuelve un resultado que siempre da mal —ingresos de
// unos días contra gastos fijos del mes entero— y se lee como una alarma.
function mesPorDefecto(hoy: string): { anio: number; mes: number } {
  const [a, m] = hoy.split('-').map(Number);
  return m === 1 ? { anio: a - 1, mes: 12 } : { anio: a, mes: m - 1 };
}

function rangoMes(anio: number, mes: number) {
  const mm = String(mes).padStart(2, '0');
  return {
    desde: `${anio}-${mm}-01`,
    hasta: `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`,
  };
}

const ARGS_MES = {
  type: 'object',
  properties: {
    anio: { type: 'number', description: 'Año. Si no se dice, el último mes cerrado.' },
    mes: { type: 'number', description: 'Mes 1-12. Si no se dice, el último mes cerrado.' },
  },
};

export const HERRAMIENTAS: Herramienta[] = [
  // ── Operativo: lo ve todo el mundo ────────────────────────────────────────────────
  {
    nombre: 'tareas_de_hoy',
    descripcion: 'Las tareas del día: qué cosechar, cuántas planchas sembrar (los miércoles) y de qué cultivo, por nave.',
    schema: { type: 'object', properties: {} },
    soloAdmin: false,
    ejecutar: async (_a, { p, hoy }) => {
      const [ubicaciones, lotes, movimientos, config] = await Promise.all([
        p.ubicaciones(), p.lotes(), p.movimientos(), p.config(),
      ]);
      const plan = calcularPlan(calcularCapacidad(ubicaciones), diasCicloDefault(lotes, movimientos));
      const cfg = config.find((i) => String(i.clave) === 'plan_reparto');
      const reparto = cfg ? parseReparto(cfg.valor) : REPARTO_DEFAULT;
      const jsDay = new Date(hoy + 'T12:00:00').getDay();
      const siembra = siembraDelDia(plan, reparto, jsDay);
      const pl = planchasSiembra(plan);
      return {
        fecha: hoy,
        tareas: tareasDelDia(plan, reparto, jsDay).map((t) => t.txt),
        siembra: siembra
          ? {
            rucula_planchas: siembra.rucPl, lechuga_planchas: siembra.lecPl, albahaca_planchas: siembra.albPl,
            // Las planchas ya vienen con el margen. Se manda tambien el numero sin margen y el
            // porcentaje para que el asistente pueda explicar de donde sale si se lo preguntan,
            // en vez de inventar una explicacion.
            margen_siembra_pct: Math.round(MARGEN_SIEMBRA * 100),
            rucula_planchas_sin_margen: siembra.rucBase, lechuga_planchas_sin_margen: siembra.lecBase,
            por_nave: { rucula: [pl.rucN1, pl.rucN2], lechuga: [pl.lecN1, pl.lecN2] },
          }
          : 'Hoy no es día de siembra (se siembra los miércoles).',
      };
    },
  },
  {
    nombre: 'lotes_en_curso',
    descripcion: 'Los lotes activos: variedad, fase, ubicación, días desde la siembra y plantas estimadas. Sirve para "qué hay en la nave 2" o "cuántos lotes de rúcula hay en F2".',
    schema: {
      type: 'object',
      properties: {
        cultivo: { type: 'string', description: 'Filtrar por texto de variedad, ej "rucula", "crespa", "roble", "albahaca".' },
        fase: { type: 'string', description: 'Filtrar por fase: plantinera, f1, f2, cosechado.' },
      },
    },
    soloAdmin: false,
    ejecutar: async (a, { p, hoy }) => {
      const lotes = await p.lotes();
      const norm = (x: any) => String(x || '').toLowerCase();
      const dias = (f: string) => f ? Math.round((new Date(hoy + 'T12:00:00').getTime() - new Date(f + 'T12:00:00').getTime()) / 86400000) : null;
      const activos = lotes
        .filter((l) => String(l.estado || '').toLowerCase() !== 'cerrado' && String(l.fase_actual || '').toLowerCase() !== 'cosechado')
        .filter((l) => !a?.cultivo || norm(l.variedad).includes(norm(a.cultivo)))
        .filter((l) => !a?.fase || norm(l.fase_actual) === norm(a.fase))
        .map((l) => ({
          id: l.id_lote, variedad: l.variedad, fase: l.fase_actual, ubicacion: l.ubicacion_actual,
          dias_desde_siembra: dias(String(l.fecha_siembra || '').split('T')[0]),
          plantas: num(l.plantas_estimadas_actual) || num(l.plantines_iniciales),
        }));
      return { total: activos.length, lotes: activos.slice(0, 60) };
    },
  },
  {
    nombre: 'stock_de_insumos',
    descripcion: 'Cuánto hay de cada insumo. Si el mes ya está contado devuelve el stock final real; si todavía no se contó —el mes en curso— devuelve el stock ESTIMADO (inicial + compras − uso teórico), que es lo que hay que usar para saber si falta comprar. Sirve para "cuántos cubos quedan" o "cuántas bolsas hay".',
    schema: {
      type: 'object',
      properties: {
        anio: { type: 'number' }, mes: { type: 'number' },
        articulo: { type: 'string', description: 'Filtrar por nombre de artículo o categoría (búsqueda por texto).' },
      },
    },
    soloAdmin: false,
    ejecutar: async (a, { p, rol, hoy }) => {
      // El mes EN CURSO por defecto, no el último cerrado: "cuántas bolsas quedan" es una
      // pregunta sobre hoy. Para el consumo del mes cerrado está consumo_historico_de_insumo.
      const [anioHoy, mesHoy] = hoy.split('-').map(Number);
      const anio = Number(a?.anio) || anioHoy, mes = Number(a?.mes) || mesHoy;
      const [articulos, stocks, lotes, ventas, precios, clientes] = await Promise.all([
        p.articulos(), p.stocks(), p.lotes(), p.ventas(), p.precios(), p.clientes(),
      ]);
      const { calcularDriversMes, usoTeoricoDeArticulo } = await import('../usoTeorico');
      const drivers = calcularDriversMes(lotes, ventas, precios, clientes, anio, mes);
      const norm = (x: any) => String(x || '').toLowerCase();
      const filas = articulos
        .filter((art) => String(art.activo) === 'SI')
        .filter((art) => !a?.articulo || norm(art.articulo).includes(norm(a.articulo)) || norm(art.categoria).includes(norm(a.articulo)))
        .map((art) => {
          const st = stocks.find((x) => String(x.id_articulo) === String(art.id_articulo)
            && String(x.anio) === String(anio) && String(x.mes) === String(mes));
          const ini = num(st?.stock_inicial), comp = num(st?.compras);
          const contado = String(st?.stock_final ?? '').trim() !== '' && num(st?.stock_final) > 0;
          const fin = num(st?.stock_final);
          const teorico = usoTeoricoDeArticulo(art, drivers);

          // ── Lo que hay HOY ────────────────────────────────────────────────────────
          //
          // Mientras no se haga el recuento, `stock_final` vale 0 en la planilla, y 0 no es
          // "no queda nada": es "todavía no se contó". Leerlo literal decía que no quedaban
          // bolsas de nada y que se habían consumido 18.584 en doce días.
          //
          // Hasta que esté el recuento, lo que hay se estima: inicial + compras − uso
          // teórico. Es una estimación y se informa como tal, pero es la única que sirve
          // para decidir si hay que comprar.
          const base: any = {
            articulo: art.articulo, categoria: art.categoria, unidad: art.unidad_medida,
            stock_inicial: ini, compras: comp,
            recuento_cargado: contado,
          };
          if (contado) {
            base.stock_final_contado = fin;
            base.consumo_real = ini + comp - fin;
            base.uso_teorico = teorico;
          } else {
            base.stock_final_contado = null;
            base.stock_estimado_hoy = teorico !== null ? Math.round((ini + comp - teorico) * 100) / 100 : null;
            base.uso_teorico = teorico;
            base.nota = teorico !== null
              ? 'Sin recuento todavía: el stock de hoy es una ESTIMACIÓN (inicial + compras − uso teórico), no un dato contado.'
              : 'Sin recuento y sin fórmula de uso teórico configurada para este artículo: no se puede estimar cuánto queda. Lo último cierto es el stock inicial del mes.';
          }
          if (rol === 'admin') base.precio_unitario = num(st?.precio_unitario) || null;
          return base;
        });
      const out: any = {
        anio, mes,
        mes_en_curso: anio === anioHoy && mes === mesHoy,
        articulos: filas,
        nota: 'El stock inicial de un mes es el stock final contado del mes anterior. Mientras el mes no esté contado, "stock_estimado_hoy" es una estimación con el uso teórico; "stock_final_contado" en null significa que todavía nadie contó, NO que no quede nada.',
      };
      if (rol === 'admin') {
        const v = calcularValorizacionMes(articulos, stocks, anio, mes);
        out.stock_valorizado_total = $(v.total);
      }
      return out;
    },
  },

  {
    nombre: 'detalle_de_lote',
    descripcion: 'Todo sobre un lote: variedad, fase, ubicación, fechas de cada fase, días en cada una, plantas, cosecha y descarte. Sirve para "cómo viene el lote L-0345".',
    schema: {
      type: 'object',
      properties: { id_lote: { type: 'string', description: 'El código del lote, ej L-0345.' } },
      required: ['id_lote'],
    },
    soloAdmin: false,
    ejecutar: async (a, { p }) => {
      const [lotes, movimientos] = await Promise.all([p.lotes(), p.movimientos()]);
      const { calcularDiasPorFase } = await import('../lotes');
      const id = String(a.id_lote || '').trim().toUpperCase();
      const l = lotes.find((x) => String(x.id_lote).toUpperCase() === id);
      if (!l) return { error: `No existe el lote ${id}.` };
      const movs = movimientos
        .filter((m) => String(m.id_lote).toUpperCase() === id)
        .sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)));
      return {
        lote: l.id_lote, variedad: l.variedad, fase: l.fase_actual, ubicacion: l.ubicacion_actual, estado: l.estado,
        fecha_siembra: String(l.fecha_siembra || '').split('T')[0],
        dias_por_fase: calcularDiasPorFase(l, movimientos),
        plantines_iniciales: num(l.plantines_iniciales),
        plantas_estimadas: num(l.plantas_estimadas_actual),
        unidades_cosechadas: num(l.unidades_cosechadas),
        plantas_por_unidad_real: num(l.plantas_por_unidad_real) || null,
        descarte_reportado: num(l.descarte_reportado),
        peso_total_estimado_kg: num(l.peso_total_estimado_kg) || null,
        notas: String(l.notas || ''),
        movimientos: movs.map((m) => ({
          fecha: String(m.fecha).split('T')[0], tipo: m.tipo,
          de: m.fase_origen || m.ubicacion_origen, a: m.fase_destino || m.ubicacion_destino,
          plantas: num(m.plantas_estimadas) || null,
          unidades_cosechadas: num(m.unidades_cosechadas) || null,
          descarte: num(m.descarte_reportado) || null,
          notas: String(m.notas || ''),
        })),
      };
    },
  },
  {
    nombre: 'cosechas_del_periodo',
    descripcion: 'Qué se cosechó en un rango de fechas, por variedad y por lote: unidades, plantas y kilos. Sirve para "cuánto cosechamos esta semana" o "cuánta rúcula salió en septiembre".',
    schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['desde', 'hasta'],
    },
    soloAdmin: false,
    ejecutar: async (a, { p }) => {
      const [lotes, movimientos] = await Promise.all([p.lotes(), p.movimientos()]);
      const desde = String(a.desde), hasta = String(a.hasta);
      const porLote = new Map(lotes.map((l) => [String(l.id_lote), l]));
      const porVariedad = new Map<string, { unidades: number; plantas: number; descarte: number; lotes: number }>();
      const detalle: any[] = [];
      for (const m of movimientos) {
        if (String(m.tipo).toLowerCase() !== 'cosecha') continue;
        const f = String(m.fecha || '').split(/[T ]/)[0];
        if (f < desde || f > hasta) continue;
        const l = porLote.get(String(m.id_lote));
        const variedad = String(l?.variedad || 'sin variedad');
        const prev = porVariedad.get(variedad) || { unidades: 0, plantas: 0, descarte: 0, lotes: 0 };
        prev.unidades += num(m.unidades_cosechadas);
        prev.plantas += num(m.plantas_estimadas);
        prev.descarte += num(m.descarte_reportado);
        prev.lotes += 1;
        porVariedad.set(variedad, prev);
        detalle.push({
          fecha: f, lote: m.id_lote, variedad,
          unidades: num(m.unidades_cosechadas), plantas: num(m.plantas_estimadas),
          descarte: num(m.descarte_reportado), cosechador: String(m.cosechador || ''),
        });
      }
      return {
        desde, hasta,
        por_variedad: [...porVariedad.entries()].map(([variedad, v]) => ({ variedad, ...v, unidades: Math.round(v.unidades), plantas: Math.round(v.plantas) })),
        cosechas: detalle.sort((x, y) => y.fecha.localeCompare(x.fecha)).slice(0, 80),
      };
    },
  },
  {
    nombre: 'descarte_por_fase',
    descripcion: 'El descarte de los últimos meses abierto por fase (plantinera, F1, F2, cámara) y por cultivo, con el porcentaje sobre lo sembrado. Sirve para "dónde se nos está yendo la planta".',
    schema: { type: 'object', properties: { meses: { type: 'number', description: 'Cuántos meses hacia atrás. Por defecto 6.' } } },
    soloAdmin: false,
    ejecutar: async (a, { p }) => {
      const [lotes, movimientos, camara] = await Promise.all([
        p.lotes(), p.movimientos(), p.hoja<any>('StockCamara'),
      ]);
      const { descartePorFaseMes, resumenDescartePorCultivo } = await import('../descarte');
      const meses = descartePorFaseMes(lotes, movimientos, camara, Math.max(1, Math.min(12, Number(a?.meses) || 6)));
      return { por_mes: meses, resumen_por_cultivo: resumenDescartePorCultivo(meses) };
    },
  },
  {
    nombre: 'ocupacion_de_naves',
    descripcion: 'Cuántas posiciones hay ocupadas y libres hoy, por nave y por mesada. Sirve para "cuánto lugar libre tengo en la nave 2".',
    schema: { type: 'object', properties: {} },
    soloAdmin: false,
    ejecutar: async (_a, { p }) => {
      const [ubicaciones, lotes] = await Promise.all([p.ubicaciones(), p.lotes()]);
      const { ocupacionPorNave, ocupacionPorMesada } = await import('../ocupacion');
      return {
        naves: ocupacionPorNave(ubicaciones, lotes),
        mesadas: ocupacionPorMesada(ubicaciones, lotes)
          .map((m) => ({ mesada: m.nombre, nave: m.nave, capacidad: m.capacidad, plantas: m.plantas_vivas, ocupacion_pct: m.ocupacion_pct, huecos: m.huecos_libres })),
      };
    },
  },
  {
    nombre: 'consumo_historico_de_insumo',
    descripcion: 'Cuánto se consumió de un artículo mes a mes, para ver si un consumo se fue de línea. Es el mismo informe comparativo de la pantalla de Stocks.',
    schema: {
      type: 'object',
      properties: {
        articulo: { type: 'string', description: 'Nombre del artículo (búsqueda por texto).' },
        meses: { type: 'number', description: 'Cuántos meses hacia atrás. Por defecto 6.' },
      },
    },
    soloAdmin: false,
    ejecutar: async (a, { p, hoy }) => {
      const [articulos, stocks] = await Promise.all([p.articulos(), p.stocks()]);
      const { emparejarHistoricos, usoHistoricoDe } = await import('../usosHistoricos');
      const pares = emparejarHistoricos(articulos.map((x) => x.articulo));
      const norm = (x: any) => String(x || '').toLowerCase();
      const n = Math.max(1, Math.min(18, Number(a?.meses) || 6));
      const def = mesPorDefecto(hoy);
      const serie: { anio: number; mes: number }[] = [];
      let anio = def.anio, mes = def.mes;
      for (let i = 0; i < n; i++) { serie.unshift({ anio, mes }); mes--; if (mes === 0) { mes = 12; anio--; } }
      const elegidos = articulos
        .filter((art) => String(art.activo) === 'SI')
        .filter((art) => !a?.articulo || norm(art.articulo).includes(norm(a.articulo)) || norm(art.categoria).includes(norm(a.articulo)));
      return {
        meses: serie.map((x) => `${x.anio}-${String(x.mes).padStart(2, '0')}`),
        articulos: elegidos.slice(0, 25).map((art) => ({
          articulo: art.articulo, unidad: art.unidad_medida,
          consumo: serie.map((x) => {
            const hist = usoHistoricoDe(art.articulo, x.anio, x.mes, pares);
            if (hist !== null) return hist;
            const st = stocks.find((y) => String(y.id_articulo) === String(art.id_articulo)
              && String(y.anio) === String(x.anio) && String(y.mes) === String(x.mes));
            return st ? num(st.uso_calculado) : null;
          }),
        })),
        nota: 'null = ese mes no tiene datos cargados, que no es lo mismo que consumo cero. Hasta agosto de 2026 los números salen del Excel anterior a la app.',
      };
    },
  },

  // ── Plata: solo admin ─────────────────────────────────────────────────────────────
  {
    nombre: 'resultado_del_mes',
    descripcion: 'El estado de resultados de un mes: ventas, costo variable por línea, costos fijos por línea y resultado. Es lo mismo que muestra la pantalla de Cierre mensual.',
    schema: ARGS_MES,
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const [articulos, stocks, gastos, ventas, precios, clientes, previsiones] = await Promise.all([
        p.articulos(), p.stocks(), p.gastos(), p.ventas(), p.precios(), p.clientes(), leerPrevisiones(),
      ]);
      const g = previsionDelMes(previsiones, anio, mes);
      const e = calcularEERR({
        articulos, stocks, gastos, ventas, precios, clientes,
        previsiones: g ? { despidos: num(g.despidos), sac: num(g.sac) } : null,
      }, anio, mes);
      return {
        anio, mes,
        ventas: $(e.ventas.total),
        costo_variable: { total: $(e.costoVariable.total), lineas: e.costoVariable.lineas.map((l) => ({ linea: l.label, monto: $(l.monto) })) },
        costos_fijos: { total: $(e.costosFijos.total), lineas: e.costosFijos.lineas.map((l) => ({ linea: l.label, monto: $(l.monto) })) },
        inversion: $(e.inversion),
        resultado: $(e.resultado),
        masa_salarial: $(e.masaSalarial),
        avisos: e.avisos,
      };
    },
  },
  {
    nombre: 'previsiones_del_mes',
    descripcion: 'Las previsiones guardadas de un mes (despidos y SAC sobre la masa salarial, más alquiler y EPE si se cargaron) y las que saldrían hoy. Dice si quedaron viejas.',
    schema: ARGS_MES,
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const [articulos, stocks, gastos, ventas, precios, clientes, previsiones] = await Promise.all([
        p.articulos(), p.stocks(), p.gastos(), p.ventas(), p.precios(), p.clientes(), leerPrevisiones(),
      ]);
      const base = calcularEERR({ articulos, stocks, gastos, ventas, precios, clientes }, anio, mes);
      const sug = previsionesSugeridas(base.masaSalarial);
      const g = previsionDelMes(previsiones, anio, mes);
      return {
        anio, mes,
        masa_salarial: $(base.masaSalarial),
        guardadas: g
          ? {
            despidos: $(num(g.despidos)), sac: $(num(g.sac)),
            alquiler: $(num(g.alquiler)), epe: $(num(g.epe)),
            usuario: String(g.usuario || ''), fecha: String(g.fecha_carga || '').split('T')[0],
          }
          : null,
        las_que_darian_hoy: { despidos: $(sug.despidos), sac: $(sug.sac) },
        nota: g
          ? 'Lo guardado es lo que fija el mes y no se recalcula solo. Si no coincide con "las que darían hoy", se cargó un sueldo después de guardarlas.'
          : 'Todavía no están guardadas. Se guardan solas a partir del día 5 del mes siguiente.',
      };
    },
  },
  {
    nombre: 'saldos_de_cuentas',
    descripcion: 'Los saldos de bancos y cajas de un mes: inicial, cobrado, gastos, movimientos entre cuentas, saldo teórico, saldo real del resumen y la diferencia. Sirve para "cuánta plata hay en Macro" o "qué cuenta no cierra".',
    schema: {
      type: 'object',
      properties: {
        anio: { type: 'number' }, mes: { type: 'number' },
        cuenta: { type: 'string', description: `Una cuenta puntual: ${MEDIOS_PAGO.join(', ')}. Si se pide una sola, se devuelve además el detalle de sus movimientos.` },
      },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const [gastos, cobranzas, saldosGuardados, cacheCob] = await Promise.all([
        p.gastos(), leerCobranzas(), leerSaldos(), p.hoja<CobranzaCache>(HOJA_COBRANZAS_CACHE),
      ]);
      const saldos = saldosDelMes(gastos, cobranzas as Cobranza[], saldosGuardados as SaldoCuenta[], anio, mes, cacheCob);
      const pedida = String(a?.cuenta || '').trim();
      const out: any = {
        anio, mes,
        cuentas: saldos.map((s) => ({
          cuenta: s.medio, inicial: $(s.inicial), hay_saldo_inicial: s.hayInicial,
          cobrado: $(s.cobranzas), gastos: $(s.gastos), entre_cuentas: $(s.entradas - s.salidas),
          saldo_teorico: $(s.calculado), saldo_real_del_resumen: s.real === null ? null : $(s.real),
          diferencia: s.diferencia === null ? null : $(s.diferencia),
        })),
        nota: '«Aporte socios» no es una cuenta de caja: es lo que los socios pagaron de su bolsillo, así que su saldo va en negativo y no se suma a la plata disponible. El saldo de VISA es una deuda y va en negativo.',
      };
      const elegida = saldos.find((s) => s.medio.toLowerCase() === pedida.toLowerCase());
      if (elegida) {
        out.detalle = movimientosDeCuenta(elegida.medio, gastos, cobranzas as Cobranza[], anio, mes, cacheCob)
          .map((m) => ({ fecha: m.fecha, descripcion: m.descripcion, monto: $(m.monto), tipo: m.tipo }));
      }
      return out;
    },
  },
  {
    nombre: 'cuenta_corriente_clientes',
    descripcion: 'Qué debe cada cliente: facturas impagas, monto y la más vieja. Con el nombre de un cliente, el detalle de sus facturas abiertas. Es el mismo criterio con el que se le reclama por mail.',
    schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre del cliente (búsqueda por texto). Vacío = todos.' },
      },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      // La misma ventana que usa la pantalla de Cobranzas. No es un detalle: lo que se da
      // por cubierto se calcula repartiendo los cobros del cliente dentro de la ventana, así
      // que con otra ventana la MISMA factura figura cobrada acá y abierta allá.
      const desde = sumarDias(hoy, -365);
      const [compsRaw, cobsRaw, cobros, clientes, saldadasFilas, edic, ajustesRaw] = await Promise.all([
        p.hoja<ComprobanteCache>(HOJA_COMPROBANTES),
        p.hoja<CobranzaCache>(HOJA_COBRANZAS_CACHE),
        p.hoja<CobroRegistrado>(HOJA_COBROS),
        p.clientes(), leerSaldadas(), leerEdiciones(), leerAjustes(),
      ]);
      // La caché guarda los comprobantes con otro nombre de campo que el bean de Xubio.
      const comprobantes = comprobantesDesdeCache(compsRaw, desde, hoy);
      const cobranzasXubio = cobranzasDesdeCache(cobsRaw, desde, hoy);
      // El cobrado sin imputar de cada cliente: es el número que decide qué figura cubierto.
      const diag: { cobradoSinImputar?: Map<string, number> } = {};
      const todas = facturasPorCliente(
        comprobantes, cobros, clientes, numerosSaldados(saldadasFilas), cobranzasXubio,
        imputacionesManuales(edic, claveComprobante),
        correccionesPorFactura(ajustesPorFactura(ajustesRaw), await leerNotas()), diag,
      );
      const norm = (x: any) => String(x || '').toLowerCase();
      const filtro = norm(a?.cliente);
      const filas = clientes
        .map((c) => {
          const id = String(c.id_control);
          const fs = todas[id] || [];
          const abiertas = fs
            .filter((f) => !f.yaCobrada && !f.saldadaManual && !f.imputadaManual && !f.cubierta)
            .sort((x, y) => x.fecha.localeCompare(y.fecha));
          const cobradoSinImputar = Math.round(diag.cobradoSinImputar?.get(id) || 0);
          // ── Por qué este cliente figura debiendo esto ───────────────────────────────
          //
          // Lo que se da por cubierto se decide repartiendo lo cobrado de la factura más
          // vieja a la más nueva, y el reparto SE CORTA en la primera que no entra entera.
          // Si la que no entra es vieja, todas las que siguen quedan figurando impagas y el
          // cliente aparece debiendo un año entero — sin que nada diga por qué.
          //
          // Por eso el corte viaja con la respuesta: es la diferencia entre "debe 30
          // millones" (indiscutible y probablemente falso) y "el reparto se cortó el 13/10
          // porque esa factura pedía más de lo que quedaba" (se revisa en un minuto).
          const d = diagnosticoReparto(fs, cobradoSinImputar);
          return {
            cliente: nombreClienteVisible(c), id, abiertas,
            resumen: {
              facturas_en_la_ventana: fs.length,
              facturado: $(fs.reduce((t, f) => t + f.importe, 0)),
              imputadas_desde_un_cobro: fs.filter((f) => f.yaCobrada).length,
              imputadas_a_mano: fs.filter((f) => f.imputadaManual).length,
              dadas_por_saldadas_a_mano: fs.filter((f) => f.saldadaManual).length,
              cubiertas_por_reparto: fs.filter((f) => f.cubierta).length,
              cobrado_sin_imputar: cobradoSinImputar,
              reparto_se_corto_en: d.corte
                ? { numero: d.corte.numero, fecha: d.corte.fecha, importe: d.corte.importe, quedaba: d.corte.restaba }
                : null,
              sobro_sin_usar: d.sobro || null,
            },
          };
        })
        .filter((x) => x.abiertas.length > 0)
        .filter((x) => !filtro || norm(x.cliente).includes(filtro))
        .sort((x, y) => y.abiertas.reduce((s, f) => s + f.importe, 0) - x.abiertas.reduce((s, f) => s + f.importe, 0));
      const cortados = filas.filter((x) => x.resumen.reparto_se_corto_en);
      return {
        total_adeudado: $(filas.reduce((s, x) => s + x.abiertas.reduce((t, f) => t + f.importe, 0), 0)),
        ventana: `últimos 365 días (desde ${desde})`,
        clientes: filas.map((x) => ({
          cliente: x.cliente,
          facturas: x.abiertas.length,
          debe: $(x.abiertas.reduce((s, f) => s + f.importe, 0)),
          mas_vieja: x.abiertas[0]?.fecha || null,
          ...x.resumen,
          // El detalle solo cuando se preguntó por un cliente: con todos sería una pared de
          // números que no se puede leer ni resumir bien.
          detalle: filtro ? x.abiertas.map((f) => ({ numero: f.numero, fecha: f.fecha, importe: $(f.importe), corregida: !!f.ajustada })) : undefined,
        })),
        clientes_con_el_reparto_cortado: cortados.map((x) => x.cliente),
        nota: [
          'Sale de los comprobantes de Xubio menos lo cobrado desde la app, lo imputado a mano, lo dado por saldado a mano y lo que cubre el reparto automático.',
          'EL REPARTO: Xubio no dice qué factura cancela cada cobro, así que la app reparte lo cobrado de la más vieja a la más nueva y SE CORTA en la primera que no entra entera.',
          'Si "reparto_se_corto_en" tiene valor, el saldo de ese cliente es un TECHO y no un dato: todas las facturas posteriores al corte figuran impagas aunque estén pagas. Hay que decirlo al contestar, no dar el número como si fuera cierto.',
          'Para arreglarlo de verdad hay que imputar los cobros a sus facturas en Cobranzas → Cobranzas del mes → corregir / imputar, o marcar las viejas como saldadas.',
        ].join(' '),
      };
    },
  },
  {
    nombre: 'gastos_del_mes',
    descripcion: 'Los gastos de un mes agrupados por categoría, y el detalle de una categoría si se pide. Sirve para "cuánto gastamos en nafta" o "en qué se fue la plata este mes".',
    schema: {
      type: 'object',
      properties: {
        anio: { type: 'number' }, mes: { type: 'number' },
        categoria: { type: 'string', description: `Una categoría puntual: ${CATEGORIAS_GASTO.map((c) => c.value).join(', ')}.` },
        buscar: { type: 'string', description: 'Texto a buscar en la descripción del gasto.' },
      },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const { desde, hasta } = rangoMes(anio, mes);
      const gastos = await p.gastos();
      const norm = (x: any) => String(x || '').toLowerCase();
      const delMes = gastos.filter((g) => {
        const f = String(g.fecha || '').split(/[T ]/)[0];
        return f >= desde && f <= hasta && g.categoria !== 'movimiento_interno';
      });
      const porCat = new Map<string, number>();
      for (const g of delMes) porCat.set(String(g.categoria), (porCat.get(String(g.categoria)) || 0) + num(g.monto));
      const detalle = (a?.categoria || a?.buscar)
        ? delMes
          .filter((g) => !a?.categoria || String(g.categoria) === String(a.categoria))
          .filter((g) => !a?.buscar || norm(g.descripcion).includes(norm(a.buscar)))
          .sort((x, y) => num(y.monto) - num(x.monto))
          .slice(0, 50)
          .map((g) => ({ fecha: String(g.fecha).split('T')[0], descripcion: g.descripcion, categoria: g.categoria, monto: $(num(g.monto)), medio_pago: g.medio_pago }))
        : undefined;
      return {
        anio, mes,
        total: $(delMes.reduce((s, g) => s + num(g.monto), 0)),
        por_categoria: [...porCat.entries()].sort((x, y) => y[1] - x[1]).map(([cat, monto]) => ({ categoria: cat, monto: $(monto) })),
        detalle,
        nota: 'Por fecha de compra (criterio devengado), que es el del resultado. Los movimientos entre cuentas no son gastos y no están.',
      };
    },
  },
  {
    nombre: 'ventas_del_periodo',
    descripcion: 'Lo vendido en un rango de fechas, por cliente y por artículo, valorizado a los precios de cada cliente.',
    schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
        cliente: { type: 'string', description: 'Filtrar por nombre de cliente.' },
      },
      required: ['desde', 'hasta'],
    },
    soloAdmin: true,
    ejecutar: async (a, { p }) => {
      const [ventas, precios, clientes] = await Promise.all([p.ventas(), p.precios(), p.clientes()]);
      const { valorDeVenta } = await import('../controlFacturacion');
      // Las claves completas: con PROD_KEYS sola, una venta por kilo valía cero y el
      // asistente contestaba totales más chicos que los reales sin decir por qué.
      const { clavesDeVenta } = await import('../clavesVenta');
      const CLAVES = await clavesDeVenta();
      const norm = (x: any) => String(x || '').toLowerCase();
      const desde = String(a.desde), hasta = String(a.hasta);
      const porCliente = new Map<string, { monto: number; unidades: number }>();
      const porArticulo = new Map<string, number>();
      let total = 0;
      for (const v of ventas) {
        const f = String(v.fecha || '').split(/[T ]/)[0];
        if (f < desde || f > hasta) continue;
        const cli = clientes.find((c) => String(c.id_control) === String(v.id_control));
        const nombre = nombreClienteVisible(cli) || String(v.nombre_cliente || '');
        if (a?.cliente && !norm(nombre).includes(norm(a.cliente))) continue;
        const monto = valorDeVenta(v, precios, clientes, CLAVES);
        let unidades = 0;
        for (const k of CLAVES) {
          const q = num((v as any)[k]);
          if (q > 0) { unidades += q; porArticulo.set(k, (porArticulo.get(k) || 0) + q); }
        }
        total += monto;
        const prev = porCliente.get(nombre) || { monto: 0, unidades: 0 };
        porCliente.set(nombre, { monto: prev.monto + monto, unidades: prev.unidades + unidades });
      }
      return {
        desde, hasta, total: $(total),
        por_cliente: [...porCliente.entries()].sort((x, y) => y[1].monto - x[1].monto)
          .map(([cliente, v]) => ({ cliente, monto: $(v.monto), unidades: Math.round(v.unidades) })),
        por_articulo: [...porArticulo.entries()].sort((x, y) => y[1] - x[1])
          .map(([articulo, unidades]) => ({ articulo, unidades: Math.round(unidades) })),
      };
    },
  },
  {
    nombre: 'deuda_a_proveedores',
    descripcion: 'Lo que la empresa debe a proveedores: compras cargadas como pendientes de pago, agrupadas por proveedor, con lo que ya está vencido y lo que vence pronto.',
    schema: { type: 'object', properties: {} },
    soloAdmin: true,
    ejecutar: async (_a, { p, hoy }) => {
      const gastos = await p.gastos();
      const { deudaProveedores, aVencerEn } = await import('../proveedores');
      const deuda = deudaProveedores(gastos, hoy);
      return {
        total: $(deuda.reduce((s2, d) => s2 + d.total, 0)),
        vencido: $(deuda.reduce((s2, d) => s2 + d.vencido, 0)),
        a_vencer_7_dias: $(aVencerEn(gastos, hoy, 7)),
        proveedores: deuda.map((d) => ({
          proveedor: d.proveedor, total: $(d.total), vencido: $(d.vencido),
          items: d.items.map((i: any) => ({ fecha: i.fecha, vencimiento: i.vencimiento, descripcion: i.descripcion, monto: $(num(i.monto)) })),
        })),
      };
    },
  },
  {
    nombre: 'compras_de_insumo',
    descripcion: 'Las compras de un insumo a lo largo del tiempo: fecha, cantidad, precio unitario y medio de pago. Sirve para ver cómo evolucionó el precio o cuándo se compró por última vez.',
    schema: {
      type: 'object',
      properties: {
        articulo: { type: 'string', description: 'Nombre del artículo (búsqueda por texto).' },
        meses: { type: 'number', description: 'Cuántos meses hacia atrás. Por defecto 12.' },
      },
      required: ['articulo'],
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const [articulos, gastos] = await Promise.all([p.articulos(), p.gastos()]);
      const norm = (x: any) => String(x || '').toLowerCase();
      const arts = articulos.filter((art) => norm(art.articulo).includes(norm(a.articulo)));
      const ids = new Set(arts.map((x) => String(x.id_articulo)));
      const n = Math.max(1, Math.min(36, Number(a?.meses) || 12));
      const [ay, am] = hoy.split('-').map(Number);
      const d = new Date(ay, am - 1 - n, 1);
      const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const compras = gastos
        .filter((g) => ids.has(String(g.id_articulo)))
        .filter((g) => String(g.fecha || '').split(/[T ]/)[0] >= desde)
        .map((g) => {
          const cant = num(g.cantidad), monto = num(g.monto);
          return {
            fecha: String(g.fecha).split('T')[0],
            articulo: arts.find((x) => String(x.id_articulo) === String(g.id_articulo))?.articulo || '',
            cantidad: cant, monto: $(monto),
            precio_unitario: cant > 0 ? Math.round((monto / cant) * 100) / 100 : null,
            medio_pago: g.medio_pago, proveedor: String(g.proveedor || ''),
            descripcion: String(g.descripcion || ''),
          };
        })
        .sort((x, y) => y.fecha.localeCompare(x.fecha));
      return { desde, articulos_encontrados: arts.map((x) => x.articulo), compras: compras.slice(0, 60) };
    },
  },
  {
    nombre: 'estado_del_cierre',
    descripcion: 'En qué está el cierre de un mes: qué pasos del checklist están hechos y cuáles faltan, con el detalle de cada uno.',
    schema: ARGS_MES,
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const def = mesPorDefecto(hoy);
      const anio = Number(a?.anio) || def.anio, mes = Number(a?.mes) || def.mes;
      const { pasosDelCierre } = await import('../cierreChecklist');
      const [articulos, stocks, gastos, ventas, precios, clientes, previsiones, cobranzas, saldosGuardados, cacheCob] = await Promise.all([
        p.articulos(), p.stocks(), p.gastos(), p.ventas(), p.precios(), p.clientes(),
        leerPrevisiones(), leerCobranzas(), leerSaldos(), p.hoja<CobranzaCache>(HOJA_COBRANZAS_CACHE),
      ]);
      const g = previsionDelMes(previsiones, anio, mes);
      const e = calcularEERR({
        articulos, stocks, gastos, ventas, precios, clientes,
        previsiones: g ? { despidos: num(g.despidos), sac: num(g.sac) } : null,
      }, anio, mes);
      const base = calcularEERR({ articulos, stocks, gastos, ventas, precios, clientes }, anio, mes);
      const saldos = saldosDelMes(gastos, cobranzas as Cobranza[], saldosGuardados as SaldoCuenta[], anio, mes, cacheCob);
      const pasos = pasosDelCierre({
        eerr: e, gastos, stocks, articulos, saldos, hayPrevision: !!g, anio, mes,
        previsionGuardada: g ? { despidos: num(g.despidos), sac: num(g.sac), usuario: String(g.usuario || '') } : null,
        previsionDeHoy: previsionesSugeridas(base.masaSalarial),
      });
      return {
        anio, mes,
        pasos: pasos.map((x) => ({ paso: x.titulo, estado: x.estado, detalle: x.detalle, se_marca_a_mano: !!x.manual })),
      };
    },
  },
  // ── Lo que faltaba ───────────────────────────────────────────────────────────────
  //
  // El asistente contesta solo con lo que devuelven estas funciones, así que una pregunta
  // sobre algo que ninguna cubre no da una respuesta mala: da un "no sé". Eso se leía como
  // que el modelo no entendía, cuando lo que pasaba era que no tenía por dónde mirar.
  //
  // Estas seis cubren lo que quedaba afuera: sueldos, horas trabajadas, precios por
  // cliente, facturación pendiente, pagos a proveedores y stock de cámara.
  {
    nombre: 'sueldos_y_horas',
    descripcion: 'Qué cobra por hora y POR JORNADA COMPLETA cada empleado, cuántas horas teóricas hace por quincena y cuánto cuesta. Sirve para saber cuánto pagarle a alguien por un día trabajado, por ejemplo un feriado. Incluye el costo total por hora de toda la gente activa.',
    schema: {
      type: 'object',
      properties: {
        empleado: { type: 'string', description: 'Filtrar por nombre. Si no se dice, van todos los activos.' },
        incluir_inactivos: { type: 'boolean', description: 'Incluir a los que ya no trabajan. Por defecto no.' },
      },
    },
    soloAdmin: true,
    ejecutar: async (a, { p }) => {
      const empleados = await p.empleados();
      const norm = (x: any) => String(x || '').toLowerCase();
      const activos = empleados.filter((e) => {
        if (!a?.incluir_inactivos && String(e.activo || '').toUpperCase() !== 'SI') return false;
        if (a?.empleado && !norm(e.nombre).includes(norm(a.empleado))) return false;
        return true;
      });
      // Las horas de la quincena: si está cargado el horario de lunes a viernes se calcula,
      // y si no se usa el número puesto a mano. Mismo orden de preferencia que la pantalla
      // de personal: si acá se decidiera al revés, el chat y la liquidación dirían cosas
      // distintas sobre el mismo sueldo.
      const horasQuincena = (e: any) => {
        const lv = num(e.horas_lv), sab = num(e.horas_sabado);
        if (lv > 0) return lv * 10 + sab * 2;   // 10 días hábiles y 2 sábados por quincena
        return num(e.horas_teoricas_quincena);
      };
      const filas = activos.map((e) => {
        const hq = horasQuincena(e);
        const hora = num(e.sueldo_hora);
        // Mismo calculo que la pantalla de Personal, importado: el valor de la jornada se
        // usa para pagar un feriado, asi que el chat y la pantalla no pueden decir dos
        // numeros distintos.
        const jornadaHs = horasDeJornada(e);
        return {
          nombre: String(e.nombre || ''),
          sueldo_por_hora: $(hora),
          horas_por_jornada: jornadaHs || null,
          valor_jornada_completa: jornadaHs > 0 ? $(jornadaHs * hora) : null,
          horas_por_quincena: Math.round(hq * 10) / 10,
          bruto_quincena: $(hora * hq),
          presentismo: $(num(e.presentismo)),
          activo: String(e.activo || '') === 'SI',
        };
      }).sort((x, y) => y.sueldo_por_hora - x.sueldo_por_hora);
      return {
        empleados: filas,
        cuantos: filas.length,
        costo_por_hora_todos: $(filas.reduce((t, f) => t + f.sueldo_por_hora, 0)),
        nota: 'El sueldo por hora es el de la ficha del empleado. El bruto de la quincena no incluye presentismo ni descuentos: es horas teóricas por el valor hora. El valor de la jornada completa es horas por día × valor hora y NO incluye recargo por feriado: la app no tiene ningún recargo cargado, así que si el día fue feriado hay que aplicarlo encima. Si dice null es que al empleado no le está cargado el horario — no asumas 8 horas, decí que falta cargarlo.',
      };
    },
  },
  {
    // ── Por que existe esta herramienta ────────────────────────────────────────────────
    //
    // `horas_trabajadas` da el acumulado del mes y nada mas, asi que a "cuantas horas se
    // hicieron ayer" el asistente tenia que contestar que no podia verlo. El dato estaba:
    // la hoja FichajesDiarios guarda una fila por empleado y por dia desde que el cron de
    // CrossChex la llena. Lo que faltaba era la puerta.
    //
    // El calculo NO se rehace: sale de calcularResumenQuincena, la misma funcion que
    // liquida los sueldos (ver lib/fichajesRango.ts). Si el chat y la liquidacion
    // calcularan distinto, el que se paga es el de la liquidacion.
    nombre: 'fichajes_por_dia',
    descripcion: 'Quien ficho cada dia y cuantas horas hizo: entrada, salida, tardanza, dia incompleto y horas de mas. Sirve para un dia puntual ("ayer"), una semana o un rango. Incluye el costo de esas horas al valor hora de cada uno, sin recargos.',
    schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha YYYY-MM-DD. Si no se dice, los ultimos 7 dias.' },
        hasta: { type: 'string', description: 'Fecha YYYY-MM-DD. Si no se dice, hoy.' },
        empleado: { type: 'string', description: 'Filtrar por nombre. Si no se dice, van todos.' },
        con_detalle_diario: { type: 'boolean', description: 'Dia por dia ademas del total por empleado. Por defecto si el rango es de 14 dias o menos.' },
      },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const { registrosDesdeCache } = await import('../fichajesCache');
      const { fichajesEnRango } = await import('../fichajesRango');

      const corrido = (dias: number) => {
        const d = new Date(`${hoy}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - dias);
        return d.toISOString().slice(0, 10);
      };
      const iso = (x: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null);
      const hasta = iso(a?.hasta) || hoy;
      const desde = iso(a?.desde) || corrido(6);
      if (desde > hasta) return { error: `El rango esta al reves: desde ${desde} es posterior a hasta ${hasta}.` };

      const [filas, empleados] = await Promise.all([p.fichajes(), p.empleados()]);
      const registros = registrosDesdeCache(filas as any, desde, hasta);

      // Sin filas en la cache no es "nadie vino": es que el cron todavia no guardo esos
      // dias. Son dos cosas muy distintas y la diferencia la tiene que decir la respuesta,
      // no el que la lee.
      const diasEnCache = new Set((filas as any[]).map((f) => String(f.fecha || '').slice(0, 10)).filter(Boolean));
      const faltan: string[] = [];
      for (let d = new Date(`${desde}T12:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) {
        const f = d.toISOString().slice(0, 10);
        if (f > hoy) break;
        if (!diasEnCache.has(f)) faltan.push(f);
      }

      const norm = (x: any) => String(x || '').toLowerCase();
      let gente = fichajesEnRango(registros, empleados, desde, hasta);
      if (a?.empleado) gente = gente.filter((g) => norm(g.nombre).includes(norm(a.empleado)));

      const largoDias = Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000) + 1;
      const detalle = a?.con_detalle_diario ?? (largoDias <= 14);

      return {
        desde, hasta,
        dias_sin_fichajes_guardados: faltan.length ? faltan : null,
        empleados: gente.map((g) => ({
          nombre: g.nombre,
          horas: g.horas,
          // Lo que marco el reloj, al lado de lo computado. Difieren cuando hubo un dia
          // incompleto: ahi se computan las horas esperadas y no las fichadas, porque el
          // tipo vino y lo que falta es el dato de la salida.
          horas_que_marco_el_reloj: g.horas_fichadas,
          dias_con_fichaje: g.dias_con_fichaje,
          dias_incompletos: g.dias_incompletos || null,
          sueldo_por_hora: $(g.sueldo_hora),
          costo_sin_recargos: $(g.horas * g.sueldo_hora),
          dias: detalle ? g.dias.filter((d) => d.entrada || d.salida).map((d) => ({
            fecha: d.fecha, dia: d.diaSemana,
            entrada: d.entrada, salida: d.salida,
            horas: Math.round((Number(d.horas) || 0) * 100) / 100,
            horas_que_marco_el_reloj: d.horasFichadas != null ? Math.round(d.horasFichadas * 100) / 100 : null,
            incompleto: d.incompleto || null,
            tardanza_min: d.tardanzaMin > 0 ? d.tardanzaMin : null,
            horas_de_mas: d.horasDeMas > 0 ? d.horasDeMas : null,
            domingo: d.esDomingo || null,
          })) : null,
        })),
        totales: {
          horas: Math.round(gente.reduce((t, g) => t + g.horas, 0) * 100) / 100,
          costo_sin_recargos: $(gente.reduce((t, g) => t + g.horas * g.sueldo_hora, 0)),
          personas: gente.length,
        },
        nota: 'Un dia incompleto (ficho la entrada y no la salida) computa las horas ESPERADAS, no las que marco el reloj; por eso pueden no coincidir los dos numeros. El costo es horas por valor hora y NO incluye recargos por feriado, nocturnidad ni horas extra: la app no tiene cargado ningun recargo, asi que si el dia fue feriado hay que aplicarlo aparte. Los domingos se marcan porque nunca son dia programado.',
      };
    },
  },
  {
    nombre: 'horas_trabajadas',
    descripcion: 'Horas-hombre fichadas y qué se hizo con ellas: plantas cosechadas y trasplantadas por mes, y la productividad resultante.',
    schema: {
      type: 'object',
      properties: { meses: { type: 'number', description: 'Cuántos meses hacia atrás. Por defecto 3.' } },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const { tablaProductividad } = await import('../productividadTabla');
      const [lotes, movimientos, horas] = await Promise.all([p.lotes(), p.movimientos(), p.horas()]);
      const meses = tablaProductividad({ lotes, movimientos, horas, hoy, meses: Math.min(12, Math.max(1, Number(a?.meses) || 3)) });
      return {
        // Todos cortados en el mismo día del mes: comparar un mes a medias contra uno
        // entero diría que la productividad bajó cuando lo que falta es calendario.
        comparados_hasta_el_dia: meses[0]?.diaCorte ?? null,
        meses: meses.map((m) => ({
          mes: m.label,
          plantas_cosechadas: m.plantasCosechadas,
          de_esas_a_granel: m.plantasGranel,
          plantas_trasplantadas: m.plantasTrasplantadas,
          horas_hombre: m.horas,
          plantas_movidas_por_hora: m.plantasPorHora,
          solo_cosecha_por_hora: m.cosechaPorHora,
          solo_trasplante_por_hora: m.trasplantePorHora,
          dias_con_fichaje: `${m.diasConDatos} de ${m.diasDelRango}`,
          incompleto: m.parcial,
        })),
        nota: 'Solo entran los días con fichaje cargado, y la cosecha y el trasplante se recortan a esos mismos días. Una planta trasplantada cuenta igual que una cosechada.',
      };
    },
  },
  {
    nombre: 'precios_por_cliente',
    descripcion: 'Qué precio se le cobra a cada cliente por artículo, cuándo fue su último aumento y de cuánto fue (en porcentaje y en pesos).',
    schema: {
      type: 'object',
      properties: { cliente: { type: 'string', description: 'Filtrar por nombre de cliente.' } },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const { ultimaTandaDeSuba, diasEntre } = await import('../reportePrecios');
      const { CAMPOS_PRECIO } = await import('../preciosHistorico');
      const [precios, clientes, historial] = await Promise.all([p.precios(), p.clientes(), p.preciosHistorico()]);
      const norm = (x: any) => String(x || '').toLowerCase();
      const vistos = new Set<string>();
      const filas: any[] = [];
      for (const pr of precios) {
        const id = String(pr.id_control || '').trim();
        if (!id || vistos.has(id)) continue;
        const cli = clientes.find((c) => String(c.id_control) === id);
        const nombre = nombreClienteVisible(cli) || String(pr.nombre_cliente || id);
        if (a?.cliente && !norm(nombre).includes(norm(a.cliente))) continue;
        vistos.add(id);
        // Una sola lista por cliente: desde hace poco el precio es el mismo para todas sus
        // sucursales, así que listar una por sucursal serían N copias de lo mismo.
        const lista = CAMPOS_PRECIO
          .map((c) => ({ articulo: c as string, precio: num((pr as any)[c]) }))
          .filter((x) => x.precio > 0);
        const tanda = ultimaTandaDeSuba(historial, id);
        filas.push({
          cliente: nombre,
          precios: lista,
          ultimo_aumento: tanda ? {
            fecha: tanda.fecha,
            hace_dias: diasEntre(tanda.fecha, hoy),
            productos: tanda.productos.map((x) => ({
              articulo: x.producto, antes: $(x.anterior), ahora: $(x.nuevo),
              sube_pesos: $(x.diferencia), sube_pct: x.variacionPct,
            })),
          } : null,
        });
      }
      return {
        clientes: filas.sort((x, y) => String(x.cliente).localeCompare(String(y.cliente))),
        nota: '"ultimo_aumento: null" puede ser un cliente nuevo o uno al que nunca se le subió: desde acá se ven igual, porque el historial de precios empezó a registrarse en algún momento y lo anterior no quedó asentado.',
      };
    },
  },
  {
    nombre: 'facturacion_pendiente',
    descripcion: 'Ventas cargadas que todavía no se facturaron en Xubio, y lo que sí se facturó cada día. Sirve para ver qué falta emitir y si algo salió dos veces.',
    schema: {
      type: 'object',
      properties: { dias: { type: 'number', description: 'Cuántos días hacia atrás. Por defecto 10.' } },
    },
    soloAdmin: true,
    ejecutar: async (a, { p, hoy }) => {
      const { armarResumen } = await import('../resumenFacturacion');
      const { clavesDeVenta } = await import('../clavesVenta');
      const [ventas, clientes, claves] = await Promise.all([p.ventas(), p.clientes(), clavesDeVenta()]);
      const r = armarResumen({
        ventas, clientes, hoy,
        dias: Math.min(90, Math.max(1, Number(a?.dias) || 10)),
        clavesExtra: claves as string[],
      });
      return {
        sin_facturar: r.totalPendientes,
        facturados: r.totalFacturados,
        por_dia: r.dias.map((d) => ({
          fecha: d.fecha, hace_dias: d.dias,
          sin_facturar: d.pendientes.map((x) => ({ cliente: x.cliente, ese_dia_ya_tiene_factura: x.tambienFacturado })),
          facturado: d.facturados.map((x) => ({ cliente: x.cliente, comprobantes: x.numeros })),
        })),
        posibles_duplicados: {
          dos_comprobantes_el_mismo_dia: r.sospechas.variosComprobantes,
          carga_pendiente_con_factura_del_mismo_dia: r.sospechas.pendienteConFactura,
        },
        nota: 'Un posible duplicado no es un veredicto: puede ser una segunda entrega real. Si no lo es, la carga pendiente se borra en vez de facturarse.',
      };
    },
  },
  {
    nombre: 'pagos_pendientes',
    descripcion: 'Las compras cargadas como "todavía no lo pagué": a qué proveedor, cuánto, cuándo vence y a qué alias hay que transferir.',
    schema: { type: 'object', properties: {} },
    soloAdmin: true,
    ejecutar: async (_a, { p, hoy }) => {
      const { resumenPagosPendientes, porVencimiento } = await import('../pagosPendientes');
      const gastos = await p.gastos();
      const r = resumenPagosPendientes(gastos, hoy);
      return {
        total: $(r.total),
        vencido: $(r.vencido),
        cuantas: r.cuantas,
        sin_alias_cargado: r.sinAlias,
        por_vencimiento: porVencimiento(r.proveedores).map((x) => ({
          proveedor: x.proveedor, descripcion: x.descripcion, monto: $(x.monto),
          vence: x.vencimiento || 'sin fecha',
          dias_para_vencer: x.diasParaVencer,
          alias: x.alias || '',
        })),
        por_proveedor: r.proveedores.map((x) => ({
          proveedor: x.proveedor, total: $(x.total), vencido: $(x.vencido), alias: x.alias || '',
        })),
      };
    },
  },
  {
    nombre: 'stock_de_camara',
    descripcion: 'Producto terminado en cámara: cuántos paquetes hay de cada cultivo, y el faltante del último conteo.',
    schema: { type: 'object', properties: {} },
    soloAdmin: false,
    ejecutar: async (_a, { p }) => {
      const { calcularCamara } = await import('../camara');
      const [registros, lotes, ventas] = await Promise.all([p.camara(), p.lotes(), p.ventas()]);
      const cultivos = ['rucula', 'lechuga_crespa', 'lechuga_roble', 'albahaca'] as const;
      return {
        cultivos: cultivos.map((c) => {
          const r = calcularCamara(c as any, registros, lotes, ventas);
          return {
            cultivo: c,
            stock_actual_paq: Math.round(r.stockActual),
            cajones: Math.round(r.cajones.stockActual),
            // Lo más viejo, no el promedio: un cultivo con 500 paquetes de ayer y 40 de
            // hace ocho días promedia día y medio, parece fresco, y hay 40 por tirarse.
            dias_lo_mas_viejo: r.diasMasViejo,
            cantidad_mas_vieja_paq: Math.round(r.cantidadMasVieja),
            ultimo_conteo: String(r.base?.fecha || '').split(/[T ]/)[0],
          };
        }),
      };
    },
  },
];

// Las herramientas que puede usar este rol. Se filtran acá, antes de armar el pedido: el
// modelo de un usuario que no es admin no sabe que las otras existen.
export function herramientasPara(rol: Rol): Herramienta[] {
  return HERRAMIENTAS.filter((h) => !h.soloAdmin || rol === 'admin');
}

export function schemasPara(rol: Rol): Anthropic.Tool[] {
  return herramientasPara(rol).map((h) => ({
    name: h.nombre,
    description: h.descripcion,
    input_schema: h.schema as any,
  }));
}
