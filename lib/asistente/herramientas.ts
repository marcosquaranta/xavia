import type Anthropic from '@anthropic-ai/sdk';
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
import { claveComprobante } from '../comprobantes';
import { nombreClienteVisible } from '../clientes';
import { HOJA_COBROS, type CobroRegistrado } from '../cobros';
import { calcularCapacidad, diasCicloDefault } from '../planificacionServer';
import { calcularPlan, parseReparto, REPARTO_DEFAULT, tareasDelDia, siembraDelDia, planchasSiembra } from '../planificacion';
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
        imputacionesManuales(edic, claveComprobante), ajustesPorFactura(ajustesRaw), diag,
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
      const { PROD_KEYS } = await import('../articulos');
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
        const monto = valorDeVenta(v, precios, clientes);
        let unidades = 0;
        for (const k of PROD_KEYS) {
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
