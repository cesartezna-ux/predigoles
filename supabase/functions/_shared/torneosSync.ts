// Traducción de TORNEOS_SYNC en Code.gs -- torneos que la sincronización
// de resultados en vivo debe mantener actualizados. Agregar uno nuevo es
// agregar una línea aquí (además de cargar su malla, subtarea 07).
export const TORNEOS_SYNC: Record<string, { leagueId: number; season: number }> = {
  fpc_2026_2: { leagueId: 239, season: 2026 }, // Liga BetPlay Colombia
  la_liga_2026_27: { leagueId: 140, season: 2026 },
  champions_2026_27: { leagueId: 2, season: 2026 },
  liga_mx_2026: { leagueId: 262, season: 2026 }, // Apertura 2026 -- este season ya viene acotado, sin Clausura mezclada
  liga_argentina_2026: { leagueId: 128, season: 2026 }, // Apertura+Clausura juntos -- cargar-fixture ya filtró solo Clausura (fase en curso)
  nations_league_2026_27: { leagueId: 5, season: 2026 }, // UEFA Nations League, arrancó 24/09/2026
};
