// Equivalente de action==="getAll" en Code.gs -- lectura pública (sin
// PIN, igual que hoy: conocer el slug del grupo ya da acceso a esto,
// por diseño del producto). Nunca toca group_secrets ni pin_hash, así
// que no hace falta un sanitizeGetAllOutput() aparte -- lo que no se
// selecciona, no puede salir.
//
// Diferencia real con Code.gs: allá "results"/"live" vivían duplicados
// en la pestaña de cada grupo. Aquí esos datos son de fixture_results
// (compartidos por torneo, ver subtareas 06/07) y el frontend los pide
// aparte, directo a Postgres vía RLS pública -- no son responsabilidad
// de esta función, que solo devuelve lo específico de ESTE grupo.
//
// Si el grupo no existe, responde success con group:null (no error) --
// misma distinción que ya construimos entre "sin conexión" (falla el
// fetch) y "grupo no existe" (el fetch funciona, pero no hay grupo).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: grupo } = await db
      .from("groups")
      .select("id, name, torneo_id, modo_seguimiento, equipos_seguidos, betting, team_overrides")
      .eq("id", tab)
      .maybeSingle();

    if (!grupo) {
      return jsonOut({ status: "success", group: null, roster: [], predictions: {}, customMatches: [] });
    }

    const [{ data: roster }, { data: preds }, { data: custom }] = await Promise.all([
      db.from("players").select("id, name, ico").eq("group_id", tab),
      db.from("predictions").select("player_id, match_id, home_score, away_score").eq("group_id", tab),
      db.from("custom_matches").select("id, home, away, kickoff, venue, fase, home_score, away_score").eq("group_id", tab),
    ]);

    // Misma forma que S.allPreds en index.html hoy: {playerId: {matchId: {h,a}}}
    const predictions: Record<string, Record<string, { h: number | null; a: number | null }>> = {};
    for (const p of preds ?? []) {
      predictions[p.player_id] ??= {};
      predictions[p.player_id][p.match_id] = { h: p.home_score, a: p.away_score };
    }

    return jsonOut({
      status: "success",
      group: {
        id: grupo.id,
        name: grupo.name,
        torneoId: grupo.torneo_id,
        modoSeguimiento: grupo.modo_seguimiento,
        equiposSeguidos: grupo.equipos_seguidos,
        betting: grupo.betting,
        teamOverrides: grupo.team_overrides,
      },
      roster: roster ?? [],
      predictions,
      customMatches: (custom ?? []).map((m) => ({
        id: m.id,
        home: m.home,
        away: m.away,
        kickoff: m.kickoff,
        venue: m.venue,
        fase: m.fase,
        homeScore: m.home_score,
        awayScore: m.away_score,
      })),
    });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
