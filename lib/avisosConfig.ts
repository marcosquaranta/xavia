// ══ A quién le llega cada aviso automático ═════════════════════════════════════════════
//
// Los destinatarios no van hardcodeados en cada cron: el día que cambie quién sigue a los
// clientes, o quién mira las cobranzas, no debería hacer falta un deploy. Viven en la hoja
// `Configuracion` y se editan desde Admin → Avisos por mail.
//
// El default de cada aviso está acá y no en blanco a propósito: un aviso configurado "a
// nadie" no falla, se manda al vacío, y nadie se entera de que existía. Con un default
// razonable el aviso funciona desde el primer día y cambiarlo es opcional.

export interface AvisoConfigurable {
  clave: string;
  titulo: string;
  descripcion: string;
  porDefecto: string[];
}

export const AVISOS: AvisoConfigurable[] = [
  {
    clave: 'email_clientes_sin_pedir',
    titulo: 'Clientes que dejaron de pedir',
    descripcion: 'Lunes y jueves. Los clientes que hace más de 6 días que no cargan un pedido (y menos de 20), ordenados por cuánto compraban.',
    porDefecto: ['juanpablosoroeta@gmail.com'],
  },
  {
    clave: 'email_ventas_sin_facturar',
    titulo: 'Ventas cargadas sin facturar',
    descripcion: 'Todos los días a la mañana, solo si hay algo. Ventas cargadas hace más de 2 días que nunca se mandaron a Xubio, separando las que faltan facturar de las que parecen carga repetida.',
    porDefecto: ['marcos.quaranta@gmail.com'],
  },
  {
    clave: 'email_alertas_stocks',
    titulo: 'Alertas de stocks e insumos (Franco)',
    descripcion: 'Todos los días a la mañana, solo si hay algo. Insumos por debajo del mínimo de días de uso, y los que quedan en pausa porque falta el cierre del mes anterior.',
    // El mail del responsable se carga en Admin → Avisos por mail, no acá: una
    // dirección personal de otra persona no tiene por qué quedar versionada en el
    // repositorio. Mientras no esté cargada, el aviso llega al dueño de la cuenta —que
    // es mejor que mandarlo al vacío y que nadie se entere de que existía.
    porDefecto: ['marcos.quaranta@gmail.com'],
  },
  {
    clave: 'email_alertas_produccion',
    titulo: 'Alertas de producción (Marcelo)',
    descripcion: 'Todos los días a la mañana, solo si hay algo. Ocupación y mesadas bajas o vacías, falta de siembras, producto viejo en cámara.',
    // El mail del responsable se carga en Admin → Avisos por mail, no acá: una
    // dirección personal de otra persona no tiene por qué quedar versionada en el
    // repositorio. Mientras no esté cargada, el aviso llega al dueño de la cuenta —que
    // es mejor que mandarlo al vacío y que nadie se entere de que existía.
    porDefecto: ['marcos.quaranta@gmail.com'],
  },
  {
    clave: 'email_alertas_ventas',
    titulo: 'Alertas de ventas (Juan Pablo)',
    descripcion: 'Todos los días a la mañana, solo si hay algo. Cajones que no vuelven. Los clientes que dejaron de pedir y las ventas sin facturar tienen aviso propio, acá no se repiten.',
    porDefecto: ['juanpablosoroeta@gmail.com'],
  },
  {
    clave: 'email_alertas_plata',
    titulo: 'Alertas de cobranzas y gastos (Marcos)',
    descripcion: 'Todos los días a la mañana, solo si hay algo. Compras a proveedores vencidas.',
    porDefecto: ['marcos.quaranta@gmail.com'],
  },
  {
    clave: 'email_cobro_automatico',
    titulo: 'Cobros que se registran solos',
    descripcion: 'En el momento en que pasa. Cuando llega un aviso de pago y las facturas que nombra suman exactamente lo que declara, la app registra la cobranza en Xubio sola y avisa al instante, con el detalle y el link para anularla.',
    porDefecto: ['marcos.quaranta@gmail.com'],
  },
];

// Los mails de un aviso: lo que esté cargado en la planilla, y si no, el default.
//
// Se acepta coma o punto y coma como separador porque las dos cosas se escriben sin pensar,
// y se descarta lo que no tenga arroba: una dirección mal escrita no hace fallar el envío,
// hace que el mail se mande a menos gente sin avisar.
export function destinatariosDe(
  clave: string,
  config: { clave: string; valor: any }[],
): string[] {
  const def = AVISOS.find((a) => a.clave === clave)?.porDefecto || [];
  const crudo = String(config.find((c) => String(c.clave).trim() === clave)?.valor || '').trim();
  if (!crudo) return def;
  const mails = crudo.split(/[,;]/).map((x) => x.trim()).filter((x) => x.includes('@'));
  return mails.length ? mails : def;
}
