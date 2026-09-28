// Equivalente de action==="resetearPinJugador" en Code.gs -- función del
// organizador (exige su PIN), distinta de admin-resetear-pin (esa resetea
// el PIN del propio organizador, desde Panel Central). Deja pin_hash en
// null para que el jugador pueda volver a registrar un PIN nuevo la
// próxima vez que entre (mismo autoregistro que login-jugador ya maneja).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, pin, playerId } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });
    if (!playerId) return jsonOut({ status: "error", message: "playerId requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkAdminAuth(db, String(tab), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);

    const { data, error } = await db
      .from("players")
      .update({ pin_hash: null })
      .eq("group_id", tab)
      .eq("id", playerId)
      .select("id");
    if (error) return errOut("resetear-pin-jugador", error);
    if (!data || data.length === 0) {
      return jsonOut({ status: "error", message: "Jugador no encontrado en este grupo." });
    }

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("resetear-pin-jugador", err);
  }
});
