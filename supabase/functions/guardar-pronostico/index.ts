// Equivalente de guardar preds_<playerId> en Code.gs. Diferencia real
// con el modelo anterior: allá "preds_<id>" era UN SOLO blob JSON con
// todos los pronósticos de ese jugador -- guardar uno solo obligaba a
// reescribir el blob completo (riesgo real: dos pestañas abiertas del
// mismo jugador podían pisarse una a otra). Aquí cada pronóstico es su
// propia fila (group_id, player_id, match_id), así que guardar uno no
// toca los demás -- ese riesgo desaparece solo, sin diseñarlo a propósito.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkPlayerAuth } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, playerId, matchId, homeScore, awayScore, pin } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });
    if (!playerId) return jsonOut({ status: "error", message: "playerId requerido." });
    if (!matchId) return jsonOut({ status: "error", message: "matchId requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkPlayerAuth(db, String(tab), String(playerId), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);

    const { error } = await db.from("predictions").upsert({
      group_id: tab,
      player_id: playerId,
      match_id: matchId,
      home_score: homeScore ?? null,
      away_score: awayScore ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) return jsonOut({ status: "error", message: String(error.message) });

    return jsonOut({ status: "success" });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
