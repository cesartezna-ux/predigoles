// Equivalente de guardar "teamOverrides" en Code.gs (editTeamName() /
// editMatchSchedule()) -- un ajuste por partido: nombre de equipo
// (home/away) y/o fecha-hora-sede (kick/venue). Ambos son EXCLUSIVOS de
// partidos personalizados (custom_matches): la API ya provee TODOS los
// partidos de un torneo, incluidas las fases eliminatorias, y los
// mantiene al día sola (ver sincronizar-resultados, que además de
// marcadores refresca equipos/fecha/sede cada corrida) -- el admin
// nunca debe poder tocar a mano ningún dato de un partido oficial.
// Esta validación se hace aquí (no solo ocultando los botones en el
// frontend) porque el cliente nunca es confiable: un llamado directo a
// la API podría saltarse esa regla si solo viviera en la UI.
//
// Solo se tocan los campos que vienen en la petición ("home" in body,
// etc.) -- así se puede, por ejemplo, borrar la fecha (mandar kick:null
// explícito) sin perder un ajuste de nombre de equipo ya guardado antes
// para ese mismo partido.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const body = await req.json();
    const { tab, pin, matchId } = body;
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });
    if (!matchId) return jsonOut({ status: "error", message: "matchId requerido." });
    // team_overrides es jsonb -- Postgres no valida su contenido, así que
    // sin esto un "kick" con basura se guardaría tal cual y solo se
    // descubriría después, como "Invalid Date" en el frontend.
    if ("home" in body && (typeof body.home !== "string" || !body.home.trim() || body.home.length > 60)) {
      return jsonOut({ status: "error", message: "Nombre de equipo (home) inválido." });
    }
    if ("away" in body && (typeof body.away !== "string" || !body.away.trim() || body.away.length > 60)) {
      return jsonOut({ status: "error", message: "Nombre de equipo (away) inválido." });
    }
    if ("venue" in body && body.venue != null && (typeof body.venue !== "string" || body.venue.length > 120)) {
      return jsonOut({ status: "error", message: "Sede inválida." });
    }
    if ("kick" in body && body.kick != null && isNaN(new Date(body.kick).getTime())) {
      return jsonOut({ status: "error", message: "Fecha/hora inválida." });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkAdminAuth(db, String(tab), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);

    if ("home" in body || "away" in body || "kick" in body || "venue" in body) {
      const { data: cm } = await db
        .from("custom_matches")
        .select("id")
        .eq("id", matchId)
        .eq("group_id", tab)
        .maybeSingle();
      if (!cm) {
        return jsonOut({ status: "error", message: "No se puede editar un partido oficial: sus datos vienen de la API y se sincronizan solos." });
      }
    }

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
    if (error) return errOut("guardar-ajuste-partido", error);

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("guardar-ajuste-partido", err);
  }
});
