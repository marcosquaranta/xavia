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
