import type { Lote, Ubicacion } from './types';

export interface FilaCapacidad {
  id_ubicacion: string;
  nombre: string;
  nombre_corto: string;
  nave: number;
  fase: string;
  variedad: string;
  perfiles: number;
  orif_por_perfil: number;
  posiciones: number;
  dias_ciclo: number;        // ciclo real promedio de cosechados en esa mesada
  ciclos_por_mes: number;
  plantas_por_mes: number;
  es_f1: boolean;            // F1 no cosecha directamente
  es_subtotal?: boolean;
  es_total?: boolean;
}

export interface ResumenCapacidad {
  nave: number;
  filas: FilaCapacidad[];
  subtotal_lechuga: { posiciones: number; plantas_por_mes: number };
  subtotal_rucula: { posiciones: number; plantas_por_mes: number };
  total_plantas_por_mes: number;
}

// Calcula ciclo real promedio de los últimos N cosechados en una ubicación dada
// Filtra outliers < 20 días (registros erróneos)
function cicloRealEnMesada(
  lotes: Lote[],
  nombreUbicacion: string,
  variedad: string,
  ultimos: number = 5,
  fallback: number = 50
): number {
  const esRucula = variedad === 'rucula';

  const cosechados = lotes
    .filter((l) => {
      if (l.estado !== 'cosechado') return false;
      const v = String(l.variedad || '').toLowerCase();
      const matchVar = esRucula
        ? v.includes('rucula') || v.includes('rúcula')
        : !v.includes('rucula') && !v.includes('rúcula') && !v.includes('albahaca');
      if (!matchVar) return false;
      // Matching flexible: normaliza tildes y sufijos entre paréntesis
      function normStr(s: string) {
        return s.trim()
          .replace(/\s*\([^)]+\)\s*$/, '')
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      }
      const ubic = String(l.ubicacion_actual || '').trim();
      return normStr(ubic) === normStr(nombreUbicacion);
    })
    .sort((a, b) => String(b.fecha_cosecha || '').localeCompare(String(a.fecha_cosecha || '')))
    .slice(0, ultimos);

  const dias = cosechados
    .map((l) => Number(l.dias_total) || 0)
    .filter((d) => d >= 20); // filtrar outliers

  if (dias.length === 0) {
    // Fallback: ciclo global de esa variedad
    const global = lotes
      .filter((l) => {
        if (l.estado !== 'cosechado') return false;
        const v = String(l.variedad || '').toLowerCase();
        return esRucula
          ? v.includes('rucula') || v.includes('rúcula')
          : !v.includes('rucula') && !v.includes('rúcula') && !v.includes('albahaca');
      })
      .map((l) => Number(l.dias_total) || 0)
      .filter((d) => d >= 20);
    if (global.length > 0) {
      return Math.round(global.reduce((a, b) => a + b, 0) / global.length);
    }
    return fallback;
  }

  return Math.round(dias.reduce((a, b) => a + b, 0) / dias.length);
}

export function calcularCapacidadMensual(
  ubicaciones: Ubicacion[],
  lotes: Lote[]
): ResumenCapacidad[] {
  const mesadas = ubicaciones
    .filter((u) => u.tipo === 'mesada' && u.activo === 'SI')
    .sort((a, b) => Number(a.orden_visual) - Number(b.orden_visual));

  const resultados: ResumenCapacidad[] = [];

  for (const nave of [1, 2]) {
    const mesadasNave = mesadas.filter((u) => Number(u.nave) === nave);
    const filas: FilaCapacidad[] = [];

    for (const u of mesadasNave) {
      const perfiles = Number(u.perfiles_por_modulo) || 0;
      const orifPerf = Number(u.orificios_por_perfil) || 0;
      const posiciones = perfiles * orifPerf;
      const esF1 = u.sector_fase === 'fase_1';
      const varAsignada = String(u.variedad_asignada || 'lechuga');
      const esRucula = varAsignada === 'rucula';

      // F1 de lechuga = buffer, no cosecha directamente
      const diasCiclo = esF1
        ? 0
        : cicloRealEnMesada(lotes, u.nombre, varAsignada, 5, esRucula ? 30 : 78);

      const ciclosPorMes = esF1 || diasCiclo === 0
        ? 0
        : Math.round((30 / diasCiclo) * 100) / 100;

      const plantasPorMes = esF1 ? 0 : Math.round(posiciones * ciclosPorMes);

      const nombreCorto = u.nombre
        .replace(/^Nave \d+ - /, '')
        .replace('Mesada Lechuga', 'Lechuga')
        .replace('Mesada Rucula', 'Rúcula')
        .replace('Mesada Rúcula', 'Rúcula');

      filas.push({
        id_ubicacion: u.id_ubicacion,
        nombre: u.nombre,
        nombre_corto: nombreCorto,
        nave,
        fase: u.sector_fase,
        variedad: varAsignada,
        perfiles,
        orif_por_perfil: orifPerf,
        posiciones,
        dias_ciclo: diasCiclo,
        ciclos_por_mes: ciclosPorMes,
        plantas_por_mes: plantasPorMes,
        es_f1: esF1,
      });
    }

    const lechugaFilas = filas.filter((f) => f.variedad === 'lechuga' && !f.es_f1);
    const ruculaFilas = filas.filter((f) => f.variedad === 'rucula');

    resultados.push({
      nave,
      filas,
      subtotal_lechuga: {
        posiciones: lechugaFilas.reduce((a, f) => a + f.posiciones, 0),
        plantas_por_mes: lechugaFilas.reduce((a, f) => a + f.plantas_por_mes, 0),
      },
      subtotal_rucula: {
        posiciones: ruculaFilas.reduce((a, f) => a + f.posiciones, 0),
        plantas_por_mes: ruculaFilas.reduce((a, f) => a + f.plantas_por_mes, 0),
      },
      total_plantas_por_mes:
        lechugaFilas.reduce((a, f) => a + f.plantas_por_mes, 0) +
        ruculaFilas.reduce((a, f) => a + f.plantas_por_mes, 0),
    });
  }

  return resultados;
}
