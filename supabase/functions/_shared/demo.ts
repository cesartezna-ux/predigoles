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

// Prioridad de audiencia probable: juicio nuestro, no medición. Se valida con
// los pronósticos reales del demo (demo_pronosticos) y se ajusta con el tiempo.
// Torneos no listados reciben PRIO_TORNEO_DEFAULT.
const PRIO_TORNEO: Record<string, number> = {
  fpc_2026_2: 30,            // Liga BetPlay (Colombia)
  liga_argentina_2026: 25,
  brasileirao_2026: 25,
  la_liga_2026_27: 25,
  liga_mx_2026: 20,
  mls_2026: 10,
  nations_league_2026_27: 10,
};
const PRIO_TORNEO_DEFAULT = 10;
// Equipos de alta audiencia; cada uno suma PRIO_EQUIPO (como subcadena, sin tildes).
const PRIO_EQUIPO = ["nacional", "millonarios", "america", "santa fe", "junior", "boca", "river", "flamengo", "corinthians", "palmeiras", "real madrid", "barcelona", "atletico madrid", "colombia", "argentina", "brasil", "spain", "england", "portugal", "france", "germany"];
const PRIO_EQUIPO_PUNTOS = 10;
// Para "siguiente prueba": partidos que empiezan dentro de esta ventana compiten por prioridad.
const VENTANA_SIGUIENTE_MS = 6 * 60 * 60 * 1000;

// Partido destacado a mano desde Panel Central (tabla demo_destacados,
// ver admin-destacado-demo): gana siempre sobre la regla general mientras
// esté vigente -- en vivo, antes de empezar, o recién terminado. Reemplaza
// el arreglo hardcodeado que exigía editar este archivo y redesplegar por
// cada partido puntual (ej. Croacia-España del 6/10/2026). Se identifica
// por match_id -- no por nombres de equipo -- porque el admin lo elige de
// una lista real de fixtures, no a mano.
export async function destacadoActivo(db: SupabaseClient): Promise<{ torneoId: string; matchId: string } | null> {
  const nowIso = new Date().toISOString();
  const { data } = await db
    .from("demo_destacados")
    .select("torneo_id, match_id")
    .lte("desde", nowIso)
    .gt("hasta", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { torneoId: data.torneo_id, matchId: data.match_id } : null;
}

export function puntajeAudiencia(torneoId: string, home: string, away: string): number {
  let s = PRIO_TORNEO[torneoId] ?? PRIO_TORNEO_DEFAULT;
  for (const equipo of [home, away]) {
    const n = sinTildes(equipo);
    if (PRIO_EQUIPO.some((e) => n.includes(e))) s += PRIO_EQUIPO_PUNTOS;
  }
  return s;
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
  // false solo para el destacado manual elegido antes de su pitazo inicial
  // (sin fila en fixture_results todavía) -- se puede pronosticar igual,
  // como en la app real, que cierra pronósticos 1 minuto antes del inicio.
  empezado: boolean;
  kickoff: string | null;
};

// Partido para el demo: primero el destacado manual si está vigente (ver
// destacadoActivo); si no hay ninguno (o ya tuvo su momento y quedó muy
// atrás), el de mayor audiencia probable entre los que están en vivo
// (sync reciente), o si no hay ninguno, entre los que terminaron hace
// poco (para revelar el ranking).
export async function partidoDemo(db: SupabaseClient): Promise<PartidoDemo | null> {
  const ahora = Date.now();
  const ventanaVivo = new Date(ahora - VENTANA_EN_VIVO_MS).toISOString();
  const ventanaRanking = new Date(ahora - VENTANA_RANKING_MS).toISOString();
  const columnas = "torneo_id, match_id, home_score, away_score, status, minute, synced_at";

  const destacado = await destacadoActivo(db);
  if (destacado) {
    const { data: resultado } = await db
      .from("fixture_results")
      .select(columnas)
      .eq("torneo_id", destacado.torneoId)
      .eq("match_id", destacado.matchId)
      .maybeSingle();
    const vivo = !!resultado && resultado.status !== null && resultado.synced_at >= ventanaVivo;
    const terminadoReciente = !!resultado && resultado.status === null && resultado.synced_at >= ventanaRanking;

    if (vivo || terminadoReciente) {
      const { data: fx } = await db.from("fixtures").select("home, away, kickoff")
        .eq("torneo_id", destacado.torneoId).eq("match_id", destacado.matchId).maybeSingle();
      if (fx) {
        return {
          torneoId: destacado.torneoId, matchId: destacado.matchId, home: fx.home, away: fx.away,
          homeScore: Number(resultado!.home_score ?? 0), awayScore: Number(resultado!.away_score ?? 0),
          minute: resultado!.minute ?? null, status: resultado!.status ?? null, enVivo: vivo, empezado: true,
          kickoff: fx.kickoff,
        };
      }
    } else if (!resultado) {
      // Nunca se ha sincronizado -- todavía no empieza. Se puede pronosticar
      // de una vez, igual que en la app real antes del pitazo inicial.
      const { data: fx } = await db.from("fixtures").select("home, away, kickoff")
        .eq("torneo_id", destacado.torneoId).eq("match_id", destacado.matchId).maybeSingle();
      if (fx) {
        return {
          torneoId: destacado.torneoId, matchId: destacado.matchId, home: fx.home, away: fx.away,
          homeScore: 0, awayScore: 0, minute: null, status: null, enVivo: false, empezado: false,
          kickoff: fx.kickoff,
        };
      }
    }
    // Si llegó aquí: el destacado ya tuvo su momento y quedó muy atrás
    // (terminó hace más de VENTANA_RANKING_MS) -- sigue el flujo normal.
  }

  const { data: vivos } = await db
    .from("fixture_results")
    .select(columnas)
    .not("status", "is", null)
    .gte("synced_at", ventanaVivo)
    .order("synced_at", { ascending: false })
    .limit(50);
  let enVivo = true;
  let candidatos = vivos ?? [];
  if (candidatos.length === 0) {
    const { data: terminados } = await db
      .from("fixture_results")
      .select(columnas)
      .is("status", null)
      .gte("synced_at", ventanaRanking)
      .order("synced_at", { ascending: false })
      .limit(50);
    candidatos = terminados ?? [];
    enVivo = false;
  }
  if (candidatos.length === 0) return null;

  // Una sola consulta de nombres para todos los candidatos (este endpoint se consulta en polling).
  const { data: fixtures } = await db
    .from("fixtures")
    .select("torneo_id, match_id, home, away")
    .in("match_id", candidatos.map((f) => f.match_id));
  const conNombres = candidatos.map((fila) => {
    const fx = (fixtures ?? []).find((f) => f.torneo_id === fila.torneo_id && f.match_id === fila.match_id);
    return fx ? { fila, fx, puntaje: puntajeAudiencia(fila.torneo_id, fx.home, fx.away) } : null;
  });
  // Mayor audiencia probable primero; empate → el sincronizado más recientemente.
  const elegido = conNombres
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((x, y) => y.puntaje - x.puntaje || new Date(y.fila.synced_at).getTime() - new Date(x.fila.synced_at).getTime())[0];
  if (!elegido) return null;

  const { fila, fx } = elegido;
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
    empezado: true,
    kickoff: null,
  };
}

// Siguiente prueba: si hay un destacado activo (ver admin-destacado-demo),
// gana siempre y de inmediato -- sin esperar a que entre en la ventana de
// las próximas horas, porque el punto de elegirlo con anticipación es
// justo poder anunciarlo antes de que esté inminente. Si no hay ninguno,
// entre los partidos que empiezan en la ventana, el de mayor audiencia
// probable; si no hay ninguno en la ventana, el que empieza primero.
export type SiguientePrueba = { torneoId: string; home: string; away: string; kickoff: string };
export async function siguientePrueba(db: SupabaseClient): Promise<SiguientePrueba | null> {
  const destacado = await destacadoActivo(db);
  if (destacado) {
    const { data: fx } = await db
      .from("fixtures")
      .select("torneo_id, home, away, kickoff")
      .eq("torneo_id", destacado.torneoId)
      .eq("match_id", destacado.matchId)
      .maybeSingle();
    if (fx) return { torneoId: fx.torneo_id, home: fx.home, away: fx.away, kickoff: fx.kickoff };
  }

  const ahora = Date.now();
  const { data: filas } = await db
    .from("fixtures")
    .select("torneo_id, home, away, kickoff")
    .gt("kickoff", new Date(ahora).toISOString())
    .order("kickoff", { ascending: true })
    .limit(200);
  if (!filas || filas.length === 0) return null;

  const enVentana = filas.filter((f) => new Date(f.kickoff).getTime() <= ahora + VENTANA_SIGUIENTE_MS);
  const grupo = enVentana.length > 0 ? enVentana : [filas[0]];
  const elegido = grupo
    .map((f) => ({ f, puntaje: puntajeAudiencia(f.torneo_id, f.home, f.away) }))
    .sort((x, y) => y.puntaje - x.puntaje || new Date(x.f.kickoff).getTime() - new Date(y.f.kickoff).getTime())[0].f;
  return { torneoId: elegido.torneo_id, home: elegido.home, away: elegido.away, kickoff: elegido.kickoff };
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
