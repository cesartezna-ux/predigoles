// Devuelve el partido del demo y sus pronósticos. Público y de solo lectura.
// Nunca expone navegador_id. Mientras el partido está en vivo muestra los
// pronósticos sin puntos; cuando termina, calcula el ranking.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { CUPO_POR_PARTIDO, partidoDemo, puntos, siguientePrueba } from "../_shared/demo.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const partido = await partidoDemo(db);
    const proxima = await siguientePrueba(db);
    if (!partido) return jsonOut({ status: "success", partido: null, proxima, entradas: [], cupo: 300, participantes: 0 });

    const { data, error } = await db
      .from("demo_pronosticos")
      .select("apodo, emoji, home_score, away_score, created_at")
      .eq("match_id", partido.matchId)
      .order("created_at", { ascending: true });
    if (error) return errOut("demo-ranking", error);

    let entradas = (data ?? []).map((e) => {
      const pronostico = { h: e.home_score, a: e.away_score };
      return {
        apodo: e.apodo,
        emoji: e.emoji,
        homeScore: e.home_score,
        awayScore: e.away_score,
        puntos: partido.enVivo ? null : puntos(pronostico, { h: partido.homeScore, a: partido.awayScore }),
      };
    });
    if (!partido.enVivo) entradas = entradas.sort((x, y) => (y.puntos ?? 0) - (x.puntos ?? 0));

    return jsonOut({
      status: "success",
      partido: {
        torneoId: partido.torneoId,
        matchId: partido.matchId,
        home: partido.home,
        away: partido.away,
        homeScore: partido.homeScore,
        awayScore: partido.awayScore,
        minute: partido.minute,
        enVivo: partido.enVivo,
      },
      proxima,
      entradas,
      participantes: entradas.length,
      cupo: CUPO_POR_PARTIDO,
    });
  } catch (err) {
    return errOut("demo-ranking", err);
  }
});
