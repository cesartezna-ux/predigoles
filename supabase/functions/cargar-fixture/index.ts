// Equivalente de cargarFixtureDesdeAPI() en Code.gs. Protegida con el
// PIN maestro -- en Code.gs esto solo se corría a mano desde el editor
// de Apps Script (nunca fue una acción HTTP pública); toda Edge Function
// es forzosamente un endpoint HTTP, así que se protege con la misma
// autenticación que el resto de operaciones administrativas centrales.
//
// El límite de 50.000 caracteres por celda de Google Sheets (que obligaba
// a usar roundContains para no reventar el límite) ya NO aplica --
// fixtures es una tabla de filas reales, no un blob JSON en una celda.
// roundContains se mantiene solo por su otra razón de ser: elegir qué
// fase de una temporada combinada (ej. Apertura+Clausura) corresponde a
// este torneoId específico.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { traducirEquipo } from "../_shared/teamDict.ts";

const APIFOOTBALL_BASE = "https://v3.football.api-sports.io";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { masterPin, torneoId, leagueId, season, roundContains } = await req.json();

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    if (!torneoId || !leagueId || !season) {
      return jsonOut({ status: "error", message: "torneoId, leagueId y season son obligatorios." });
    }

    const apiKey = Deno.env.get("APIFOOTBALL_KEY") || "";
    if (!apiKey) return jsonOut({ status: "error", message: "Falta configurar APIFOOTBALL_KEY como secreto de Supabase." });

    const url = `${APIFOOTBALL_BASE}/fixtures?league=${leagueId}&season=${season}`;
    const resp = await fetch(url, { headers: { "x-apisports-key": apiKey } });
    if (resp.status !== 200) return jsonOut({ status: "error", message: `Error API (HTTP ${resp.status})` });
    const parsed = await resp.json();
    if (parsed.errors && Object.keys(parsed.errors).length) {
      return jsonOut({ status: "error", message: `Error API: ${JSON.stringify(parsed.errors)}` });
    }

    // api-football agrupa TODA la temporada bajo un solo "season" -- en
    // ligas con Apertura y Clausura (como la colombiana) eso trae ambos
    // torneos juntos. roundContains filtra por el nombre de fase para
    // quedarnos solo con la malla que de verdad queremos para este torneoId.
    let response = parsed.response ?? [];
    if (roundContains) {
      response = response.filter((m: any) => String(m.league?.round || "").includes(roundContains));
    }
    if (!response.length) {
      return jsonOut({ status: "error", message: "La API no devolvió partidos para esos parámetros." });
    }

    const fixturesRows: Record<string, unknown>[] = [];
    const crestsMap = new Map<string, string>();

    for (const m of response) {
      // status.short "TBD" = fecha/hora todavía no confirmada por la liga.
      const kick = m.fixture.status.short === "TBD" ? null : m.fixture.date;
      const venue = m.fixture.venue?.name
        ? m.fixture.venue.name + (m.fixture.venue.city ? `, ${m.fixture.venue.city}` : "")
        : "Estadio por confirmar";
      const home = traducirEquipo(m.teams.home.name);
      const away = traducirEquipo(m.teams.away.name);
      if (m.teams.home.logo) crestsMap.set(home, m.teams.home.logo);
      if (m.teams.away.logo) crestsMap.set(away, m.teams.away.logo);

      fixturesRows.push({
        torneo_id: torneoId,
        match_id: `af_${m.fixture.id}`,
        fase: String(m.league?.round || ""),
        kickoff: kick,
        home,
        away,
        venue,
      });
    }

    // Sobrescribe la malla completa de este torneo -- mismo comportamiento
    // que setKey(tab, "partidos", json) en Code.gs (reemplazo total, no
    // fusión), para que un partido que desaparezca de la API (cancelado,
    // reprogramado con otro id) no quede como reliquia.
    const { error: delErr } = await db.from("fixtures").delete().eq("torneo_id", torneoId);
    if (delErr) return jsonOut({ status: "error", message: String(delErr.message) });

    const { error: insErr } = await db.from("fixtures").insert(fixturesRows);
    if (insErr) return jsonOut({ status: "error", message: String(insErr.message) });

    const crestRows = [...crestsMap.entries()].map(([team_name, crest_url]) => ({
      torneo_id: torneoId, team_name, crest_url,
    }));
    if (crestRows.length) {
      const { error: crestErr } = await db.from("team_crests").upsert(crestRows, { onConflict: "torneo_id,team_name" });
      if (crestErr) return jsonOut({ status: "error", message: String(crestErr.message) });
    }

    return jsonOut({ status: "success", partidos: fixturesRows.length, escudos: crestRows.length });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
