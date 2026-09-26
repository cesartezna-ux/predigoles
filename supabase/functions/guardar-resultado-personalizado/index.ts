// Guarda el resultado de un partido PERSONALIZADO (custom_matches) --
// el único caso donde el organizador ingresa un resultado a mano, porque
// por definición no existe en ninguna API para sincronizar. Los partidos
// oficiales del calendario NUNCA se corrigen a mano: siempre vía API
// (fixture_results, subtarea 06) -- si un resultado oficial sale mal
// mapeado, el arreglo correcto es TEAM_DICT/el mapeo, no un parche aquí.
//
// A diferencia de la clave "custom" en Code.gs (que no pasaba por
// checkAdminAuth en la acción genérica "set" -- un hueco angosto), esta
// función sí exige el PIN del organizador.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, matchId, homeScore, awayScore, pin } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });
    if (!matchId) return jsonOut({ status: "error", message: "matchId requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkAdminAuth(db, String(tab), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);

    // El filtro por group_id (no solo por id) es lo que impide que el
    // organizador de un grupo edite el partido personalizado de otro,
    // aunque adivinara o reutilizara un matchId ajeno.
    const { data, error } = await db
      .from("custom_matches")
      .update({ home_score: homeScore ?? null, away_score: awayScore ?? null })
      .eq("id", matchId)
      .eq("group_id", tab)
      .select("id");
    if (error) return jsonOut({ status: "error", message: String(error.message) });
    if (!data || data.length === 0) {
      return jsonOut({ status: "error", message: "Partido personalizado no encontrado en este grupo." });
    }

    return jsonOut({ status: "success" });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
