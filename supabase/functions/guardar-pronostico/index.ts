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
import { errOut } from "../_shared/errOut.ts";

// Mismo rango que clampVal() en el frontend (0-49) -- se repite aquí porque
// un llamado directo a la API se salta cualquier límite que solo viva en
// el cliente. home_score/away_score son "int" sin CHECK en Postgres, así
// que sin esto se podría guardar un marcador negativo o absurdamente
// grande y dañar el ranking de todo el grupo.
function marcadorValido(v: unknown): boolean {
  return v === null || v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 49);
}

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, playerId, matchId, homeScore, awayScore, pin } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });
    if (!playerId) return jsonOut({ status: "error", message: "playerId requerido." });
    if (!matchId) return jsonOut({ status: "error", message: "matchId requerido." });
    if (!marcadorValido(homeScore) || !marcadorValido(awayScore)) {
      return jsonOut({ status: "error", message: "El marcador debe ser un número entero entre 0 y 49." });
    }

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
    if (error) return errOut("guardar-pronostico", error);

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("guardar-pronostico", err);
  }
});
