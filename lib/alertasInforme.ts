// ── Lo que hay que mirar de este informe ─────────────────────────────────────────────
//
// El informe mensual son cuarenta números bien puestos. El problema de cuarenta números
// bien puestos es que no dicen por dónde empezar: el que lo abre tiene que recorrerlo
// entero para descubrir que lo único raro del mes fue el descarte de cámara.
//
// Esto va PRIMERO y dice qué cambió. No agrega información: lee los mismos números que
// están más abajo y los ordena por cuánto se movieron. Si todo está estable, lo dice en una
// línea y el informe se lee tranquilo — que también es una respuesta.
//
// Regla para agregar una alerta acá: tiene que ser algo sobre lo que se pueda hacer algo.
// "Las ventas subieron 28%" es una buena noticia y no una tarea, pero igual va: un cambio
// grande en cualquier dirección merece una mirada, y esconder los buenos deja el bloque
// como una lista de retos que nadie quiere abrir.

export type NivelAlerta = 'alta' | 'media' | 'info';

export interface AlertaInforme {
  nivel: NivelAlerta;
  titulo: string;
  detalle?: string;
  // A qué sección del informe ir. Sin esto, el bloque dice que algo pasa y obliga a
  // buscarlo a ojo en cuarenta números.
  ancla?: string;
}

export interface EntradaAlertas {
  ventasMes: number | null;
  ventasMesAnterior: number | null;
  // Plantas por paquete de rúcula: el primer y el último mes de la serie.
  plantasPaqPrimero: number | null;
  plantasPaqUltimo: number | null;
  descarteCamaraPaq: number;
  eficienciaPct: number | null;
  eficienciaObjetivo: number | null;
  ocupacionPct: number | null;
  ocupacionObjetivo: number | null;
  // Días de ciclo por nave, para avisar cuando una tarda más que la otra con el mismo
  // cultivo: esa diferencia es física y se puede ir a buscar.
  difNaves: { cultivo: string; dias: number }[];
  // Clientes que vienen cayendo dos meses seguidos.
  clientesEnCaida: string[];
}

const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10);
const $ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

// Umbrales. Están acá arriba y con nombre para que discutir "¿a partir de cuánto avisa?"
// sea cambiar un número y no leer el código.
export const UMBRAL_VENTAS_PCT = 15;
export const UMBRAL_PLANTAS_PAQ = 0.3;
export const UMBRAL_DESCARTE_CAMARA_PAQ = 100;
export const UMBRAL_DIAS_ENTRE_NAVES = 2;

export function alertasDelInforme(e: EntradaAlertas): AlertaInforme[] {
  const out: AlertaInforme[] = [];

  // ── Ventas ──
  if (e.ventasMes !== null && e.ventasMesAnterior !== null && e.ventasMesAnterior > 0) {
    const v = pct(e.ventasMes, e.ventasMesAnterior);
    if (v !== null && Math.abs(v) >= UMBRAL_VENTAS_PCT) {
      out.push({
        nivel: v < 0 ? 'alta' : 'info',
        titulo: `Ventas ${v > 0 ? '↑' : '↓'} ${Math.abs(v)}% contra el mes anterior`,
        detalle: `${$(e.ventasMes)} contra ${$(e.ventasMesAnterior)}.`,
        ancla: '#ventas',
      });
    }
  }

  // ── Plantas por paquete ──
  //
  // Es el indicador que más calladamente encarece el producto: el mismo paquete con menos
  // plantas significa plantas más pesadas, o sea más tiempo de nave por paquete vendido.
  if (e.plantasPaqPrimero !== null && e.plantasPaqUltimo !== null) {
    const d = Math.round((e.plantasPaqUltimo - e.plantasPaqPrimero) * 100) / 100;
    if (Math.abs(d) >= UMBRAL_PLANTAS_PAQ) {
      out.push({
        nivel: d < 0 ? 'alta' : 'media',
        titulo: `Rúcula: ${d > 0 ? 'más' : 'menos'} plantas por paquete (${e.plantasPaqPrimero} → ${e.plantasPaqUltimo})`,
        detalle: d < 0
          ? 'Cada planta viene más pesada: es el mismo paquete con menos material, y más tiempo de nave por paquete.'
          : 'Entran más plantas por paquete: plantas más chicas.',
        ancla: '#produccion',
      });
    }
  }

  // ── Descarte de cámara ──
  //
  // Es el descarte más caro de todos: producto terminado, que ya pagó semilla, agua,
  // cosecha y empaque. Por eso tiene su propia alerta y no entra en el promedio del resto.
  if (e.descarteCamaraPaq >= UMBRAL_DESCARTE_CAMARA_PAQ) {
    out.push({
      nivel: 'alta',
      titulo: `${Math.round(e.descarteCamaraPaq).toLocaleString('es-AR')} paquetes tirados en cámara`,
      detalle: 'Producto terminado: ya pagó semilla, agua, cosecha y empaque.',
      ancla: '#produccion',
    });
  }

  // ── Objetivos ──
  if (e.eficienciaPct !== null && e.eficienciaObjetivo !== null && e.eficienciaPct < e.eficienciaObjetivo) {
    out.push({
      nivel: 'media',
      titulo: `Eficiencia siembra → cosecha en ${e.eficienciaPct}% (objetivo ${e.eficienciaObjetivo}%)`,
      ancla: '#produccion',
    });
  }
  if (e.ocupacionPct !== null && e.ocupacionObjetivo !== null && e.ocupacionPct < e.ocupacionObjetivo) {
    out.push({
      nivel: 'media',
      titulo: `Ocupación en ${e.ocupacionPct}% (objetivo ${e.ocupacionObjetivo}%)`,
      ancla: '#produccion',
    });
  }

  // ── Diferencia entre naves ──
  for (const d of e.difNaves) {
    if (Math.abs(d.dias) < UMBRAL_DIAS_ENTRE_NAVES) continue;
    out.push({
      nivel: 'media',
      titulo: `${d.cultivo}: la nave ${d.dias > 0 ? '2' : '1'} tarda ${Math.abs(d.dias)} días más`,
      detalle: 'Con el mismo cultivo esa diferencia es física —luz, temperatura o solución— y son vueltas de mesada por mes.',
      ancla: '#produccion',
    });
  }

  // ── Clientes que se están yendo ──
  if (e.clientesEnCaida.length) {
    out.push({
      nivel: 'alta',
      titulo: `${e.clientesEnCaida.length} cliente(s) cayendo dos meses seguidos`,
      detalle: e.clientesEnCaida.join(' · ') + '. Un cliente que cae dos meses seguidos se está yendo, aunque el total no se mueva.',
      ancla: '#ventas',
    });
  }

  // Lo más grave primero. Dentro de cada nivel se respeta el orden en que se agregaron,
  // que ya va de lo más caro a lo menos.
  const peso: Record<NivelAlerta, number> = { alta: 0, media: 1, info: 2 };
  return out.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
}
