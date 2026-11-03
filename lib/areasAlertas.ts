// ══ A quién le toca cada alerta ═══════════════════════════════════════════════════════
//
// Hasta acá todas las alertas iban al mismo lugar: el Panel, donde las ve quien entra, y el
// reporte semanal, que llega entero a administración. El resultado es que cada uno tiene
// que leer las alertas de los otros tres para encontrar la suya, y nadie lee las de nadie.
//
// Ahora cada alerta tiene un área y cada área un responsable. El reporte semanal completo
// NO cambia —es la mirada de conjunto y la sigue recibiendo administración—; lo que se
// agrega es un mail corto por área, con lo de esa área y nada más.
//
// ── Por qué el área se decide acá y no en cada generador ──
//
// Los generadores (lib/alertasPanel.ts, lib/cajones.ts, lib/alertasVentas.ts) no saben nada
// de quién mira qué, y está bien: el día que Franco pase a mirar producción, esto cambia en
// un lugar y no en seis. El área es una decisión de organización, no una propiedad del dato.

export type AreaAlerta = 'stocks' | 'produccion' | 'ventas' | 'plata';

export interface AreaConfig {
  area: AreaAlerta;
  titulo: string;
  // Quién la mira hoy. Es solo una etiqueta para el mail: a quién le llega lo decide
  // `clave` contra la hoja de configuración.
  responsable: string;
  clave: string;
  queIncluye: string;
}

export const AREAS: AreaConfig[] = [
  {
    area: 'stocks',
    titulo: 'Stocks e insumos',
    responsable: 'Franco',
    clave: 'email_alertas_stocks',
    queIncluye: 'Insumos por debajo del mínimo de días de uso, y los que quedan en pausa porque falta el cierre del mes anterior.',
  },
  {
    area: 'produccion',
    titulo: 'Producción',
    responsable: 'Marcelo',
    clave: 'email_alertas_produccion',
    queIncluye: 'Lotes demorados, ocupación y mesadas bajas o vacías, falta de siembras, y producto viejo en cámara.',
  },
  {
    area: 'ventas',
    titulo: 'Ventas',
    responsable: 'Juan Pablo',
    clave: 'email_alertas_ventas',
    queIncluye: 'Cajones que no vuelven. Los clientes que dejaron de pedir y las ventas sin facturar tienen su propio mail y no se repiten acá.',
  },
  {
    area: 'plata',
    titulo: 'Cobranzas y gastos',
    responsable: 'Marcos',
    clave: 'email_alertas_plata',
    queIncluye: 'Compras a proveedores vencidas y cobros que entraron y están sin imputar.',
  },
];

export interface AlertaArea {
  area: AreaAlerta;
  tipo: 'error' | 'warn' | 'info';
  msg: string;
  href?: string;
}

// Agrupa y ordena: primero lo urgente. Un mail que empieza por un aviso informativo y
// esconde el error tres renglones abajo se lee como si no pasara nada.
export function porArea(alertas: AlertaArea[]): Map<AreaAlerta, AlertaArea[]> {
  const peso = { error: 0, warn: 1, info: 2 } as const;
  const out = new Map<AreaAlerta, AlertaArea[]>();
  for (const a of alertas) {
    const l = out.get(a.area) || [];
    l.push(a);
    out.set(a.area, l);
  }
  for (const l of out.values()) l.sort((a, b) => peso[a.tipo] - peso[b.tipo]);
  return out;
}

const COLOR = { error: '#dc2626', warn: '#b45309', info: '#2563eb' } as const;
const ICONO = { error: '🔴', warn: '🟡', info: '🔵' } as const;

export function htmlDeArea(cfg: AreaConfig, alertas: AlertaArea[], baseUrl: string): string {
  const urgentes = alertas.filter((a) => a.tipo === 'error').length;
  return `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:620px">
      <h2 style="margin:0 0 2px;font-size:18px">${cfg.titulo} — ${alertas.length} ${alertas.length === 1 ? 'alerta' : 'alertas'}</h2>
      <p style="margin:0 0 14px;color:#6b7280;font-size:13px">
        ${urgentes > 0 ? `<strong style="color:#dc2626">${urgentes} para mirar hoy.</strong> ` : ''}${cfg.queIncluye}
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <tbody>
          ${alertas.map((a) => `<tr>
            <td style="padding:7px 8px 7px 0;border-bottom:1px solid #f0f0f0;vertical-align:top;width:20px">${ICONO[a.tipo]}</td>
            <td style="padding:7px 0;border-bottom:1px solid #f0f0f0;color:${COLOR[a.tipo]}">
              ${a.msg}
              ${a.href ? ` <a href="${baseUrl}${a.href}" style="color:#2563eb;text-decoration:none">→ abrir</a>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">
        Llega solo si hay algo: un mail diario que casi siempre dice “sin novedades” se archiva sin abrir, y el día que
        traiga algo tampoco se va a leer. Para cambiar a quién le llega: Admin → Avisos por mail.
      </p>
    </div>`;
}
