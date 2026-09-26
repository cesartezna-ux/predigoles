// Equivalente de action==="joinRoster" en Code.gs. Sin PIN a propósito,
// igual que hoy -- es el paso de onboarding ANTES de que exista cualquier
// PIN (login-jugador exige que este paso haya corrido primero, ver la
// nota de diseño en login-jugador/index.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, player } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });
    if (!player?.id || !player?.name) {
      return jsonOut({ status: "error", message: "player inválido." });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existente } = await db
      .from("players")
      .select("id")
      .eq("group_id", tab)
      .eq("id", player.id)
      .maybeSingle();

    if (existente) {
      // Mismo id de antes: actualiza nombre/ícono, deja el pin_hash intacto.
      const { error } = await db
        .from("players")
        .update({ name: player.name, ico: player.ico ?? null })
        .eq("group_id", tab)
        .eq("id", player.id);
      if (error) return jsonOut({ status: "error", message: String(error.message) });
    } else {
      const { error } = await db
        .from("players")
        .insert({ group_id: tab, id: player.id, name: player.name, ico: player.ico ?? null });
      if (error) {
        // El índice único (group_id, lower(name)) es lo que antes revisaba
        // "nombreTomado" a mano en Code.gs -- aquí la base de datos lo
        // hace cumplir directamente; 23505 = violación de unicidad.
        if (error.code === "23505") {
          const { data: roster } = await db.from("players").select("id, name, ico").eq("group_id", tab);
          return jsonOut({ status: "name_taken", roster: roster ?? [] });
        }
        return jsonOut({ status: "error", message: String(error.message) });
      }
    }

    const { data: roster } = await db.from("players").select("id, name, ico").eq("group_id", tab);
    return jsonOut({ status: "success", roster: roster ?? [] });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
