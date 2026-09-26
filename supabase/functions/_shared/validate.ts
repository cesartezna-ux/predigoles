// Traducción de sanitizeTab() en Code.gs. Nota: la parte de "nombres
// reservados" de Code.gs (tabs que empiezan con "_", o iguales a
// "_grupos_maestro") ya no aplica -- eso existía porque Sheets mezclaba
// grupos reales y tablas internas en el mismo espacio de nombres de
// pestañas. Aquí "groups" y "fixtures" son tablas separadas de verdad,
// así que esa clase entera de colisión ya no puede ocurrir.
const GRUPO_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;

export function sanitizeTab(tab: unknown): string | null {
  if (typeof tab !== "string") return null;
  return GRUPO_ID_RE.test(tab) ? tab : null;
}
