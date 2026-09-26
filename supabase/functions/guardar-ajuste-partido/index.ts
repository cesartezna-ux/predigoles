// Equivalente de guardar "teamOverrides" en Code.gs (editTeamName() /
// editMatchSchedule()) -- un ajuste por partido, específico de ESTE
// grupo: nombre de equipo (home/away) y/o fecha-hora-sede (kick/venue).
// Aplica tanto a partidos oficiales (compartidos entre grupos en
// fixtures) como a los personalizados -- el ajuste vive en el grupo, así
// que nunca se filtra a otro grupo que siga el mismo torneo.
//
// Solo se tocan los campos que vienen en la petición ("home" in body,
// etc.) -- así se puede, por ejemplo, borrar la fecha (mandar kick:null
// explícito) sin perder un ajuste de nombre de equipo ya guardado antes
// para ese mismo partido.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const body = await req.json();
    const { tab, pin, matchId } = body;
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });
    if (!matchId) return jsonOut({ status: "error", message: "matchId requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkAdminAuth(db, String(tab), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);

    const { data: grupo } = await db.from("groups").select("team_overrides").eq("id", tab).maybeSingle();
    if (!grupo) return jsonOut({ status: "error", message: "Grupo no encontrado." });

    const overrides = (grupo.team_overrides as Record<string, any>) || {};
    const actual = { ...(overrides[matchId] || {}) };
    if ("home" in body) actual.home = body.home;
    if ("away" in body) actual.away = body.away;
    if ("kick" in body) actual.kick = body.kick;
    if ("venue" in body) actual.venue = body.venue;
    overrides[matchId] = actual;

    const { error } = await db.from("groups").update({ team_overrides: overrides }).eq("id", tab);
    if (error) return jsonOut({ status: "error", message: String(error.message) });

    return jsonOut({ status: "success" });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
