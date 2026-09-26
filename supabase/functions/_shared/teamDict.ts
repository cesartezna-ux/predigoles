// Traducción exacta de TEAM_DICT en Code.gs. api-football.com a veces usa
// nombres oficiales ligeramente distintos a los nuestros (sin "F.C.", o
// con variantes de acento). Si la sincronización reporta partidos "sin
// mapear" que sí están jugándose, es casi seguro que el nombre que
// devuelve la API no coincide exacto -- agrégalo aquí.
export const TEAM_DICT: Record<string, string> = {
  "America de Cali": "América de Cali",
  "Independiente Medellin": "Independiente Medellín",
  "Deportes Tolima": "Deportes Tolima",
  "Llaneros": "Llaneros F.C.",
  "Atletico Bucaramanga": "Atlético Bucaramanga",
  "Aguilas Doradas": "Águilas Doradas",
  "Deportivo Cali": "Deportivo Cali",
  "Millonarios": "Millonarios F.C.",
  "Once Caldas": "Once Caldas DAF",
  "Fortaleza CEIF": "Fortaleza",
  "Independiente Santa Fe": "Independiente Santa Fe",
  "Internacional": "Internacional de Bogotá",
  "Jaguares de Cordoba": "Jaguares F.C.",
  "Atletico Nacional": "Atlético Nacional",
  "Cucuta Deportivo": "Cúcuta Deportivo",
  "Deportivo Pereira": "Deportivo Pereira",
  "Alianza": "Alianza Valledupar F.C.",
  "Junior": "Junior F.C.",
  "Deportivo Pasto": "Deportivo Pasto",
  "Boyaca Chico": "Boyacá Chicó F.C.",
  // A partir del Clausura 2026-2 la API empezó a devolver nombres más
  // cortos para estos 7 equipos. Se agregan sin borrar las variantes de
  // arriba, por si la API vuelve a usar el nombre largo en otra temporada.
  "Alianza Valledupar": "Alianza Valledupar F.C.",
  "Bucaramanga": "Atlético Bucaramanga",
  "Chico": "Boyacá Chicó F.C.",
  "Cucuta": "Cúcuta Deportivo",
  "Fortaleza FC": "Fortaleza",
  "Jaguares": "Jaguares F.C.",
  "Santa Fe": "Independiente Santa Fe",
};

export function traducirEquipo(nombreAPI: string): string {
  return TEAM_DICT[nombreAPI] ?? nombreAPI;
}
