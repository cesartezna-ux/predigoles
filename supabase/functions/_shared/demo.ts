// Lógica del demo público de la landing (ver migración 007). Es un embudo:
// pronósticos sobre un partido ya iniciado, sin PIN ni grupo. Vive aparte de
// los grupos reales a propósito -- nada de aquí toca pronósticos de pago.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const EMOJIS_DEMO = ["⚽", "🏆", "🔥", "😎", "🦁", "🐯"];
export const CUPO_POR_PARTIDO = 300;
// Un partido se considera "en vivo" si su última sincronización fue hace
// menos de esto. Evita mostrar como en vivo un partido que ya terminó pero
// cuya sincronización se quedó congelada.
const VENTANA_EN_VIVO_MS = 15 * 60 * 1000;
// Después de terminar, el ranking del demo sigue visible esta cantidad de tiempo.
const VENTANA_RANKING_MS = 2 * 60 * 60 * 1000;

// Filtro básico de groserías (en minúsculas, sin tildes). No es perfecto:
// su trabajo es frenar lo obvio; lo demás se borra desde Panel Central.
const PALABRAS_BLOQUEADAS = ["puta", "puto", "mierda", "hijueputa", "jueputa", "marica", "pendejo", "idiota", "perra", "gonorrea"];

function sinTildes(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Devuelve el apodo limpio o null si no es válido.
export function apodoValido(crudo: string): string | null {
  const limpio = crudo.trim().replace(/\s+/g, " ");
  if (limpio.length < 2 || limpio.length > 20) return null;
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(limpio)) return null;
  const normal = sinTildes(limpio).replace(/[^a-z]/g, "");
  if (PALABRAS_BLOQUEADAS.some((p) => normal.includes(p))) return null;
  return limpio;
}

export function marcadorValido(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
}

export type PartidoDemo = {
  torneoId: string;
  matchId: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  minute: number | null;
  status: string | null;
  enVivo: boolean;
};

// Partido para el demo: primero el que está en vivo (con sync reciente); si no
// hay ninguno, el último que terminó hace poco (para revelar el ranking).
export async function partidoDemo(db: SupabaseClient): Promise<PartidoDemo | null> {
  const ahora = Date.now();
  const { data: vivos } = await db
    .from("fixture_results")
    .select("torneo_id, match_id, home_score, away_score, status, minute, synced_at")
    .not("status", "is", null)
    .order("synced_at", { ascending: false })
    .limit(1);

  let fila = vivos?.[0];
  let enVivo = true;
  if (!fila || ahora - new Date(fila.synced_at).getTime() > VENTANA_EN_VIVO_MS) {
    const { data: terminados } = await db
      .from("fixture_results")
      .select("torneo_id, match_id, home_score, away_score, status, minute, synced_at")
      .is("status", null)
      .order("synced_at", { ascending: false })
      .limit(1);
    fila = terminados?.[0];
    enVivo = false;
    if (!fila || ahora - new Date(fila.synced_at).getTime() > VENTANA_RANKING_MS) return null;
  }

  const { data: fx } = await db
    .from("fixtures")
    .select("home, away")
    .eq("torneo_id", fila.torneo_id)
    .eq("match_id", fila.match_id)
    .maybeSingle();
  if (!fx) return null;

  return {
    torneoId: fila.torneo_id,
    matchId: fila.match_id,
    home: fx.home,
    away: fx.away,
    homeScore: Number(fila.home_score ?? 0),
    awayScore: Number(fila.away_score ?? 0),
    minute: fila.minute ?? null,
    status: fila.status ?? null,
    enVivo,
  };
}

// Mismo criterio que ptsFor() del frontend: 1 punto por acertar el ganador
// (o el empate), 2 más por marcador exacto.
export function puntos(p: { h: number; a: number }, r: { h: number; a: number }): number {
  const signo = (x: number, y: number) => (x > y ? "1" : x < y ? "2" : "X");
  let s = 0;
  if (signo(p.h, p.a) === signo(r.h, r.a)) s += 1;
  if (p.h === r.h && p.a === r.a) s += 2;
  return s;
}
