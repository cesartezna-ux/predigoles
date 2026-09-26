// Equivalente de _sincronizar()/_sincronizarTorneo()/cronSincronizarResultados()
// en Code.gs. Pensada para invocarse por cron (ver
// supabase/migrations/004_cron_sincronizar.sql), no por el usuario final --
// no requiere PIN porque no la llama el frontend en ningún momento.
//
// Simplificación real respecto a Code.gs: allá había que escribir el mismo
// resultado en la pestaña de CADA grupo que sigue un torneo. Aquí
// fixture_results es una sola tabla compartida por torneo -- un solo
// upsert por partido, sin loop de tenants, sin riesgo de que un grupo
// quede desincronizado de otro.
//
// Simplificación deliberada: se elimina el respaldo de "emparejar por
// nombre" que tenía Code.gs para fixtures sin id real de api-football --
// el propio comentario allá decía "no debería pasar con la malla actual,
// que siempre viene de cargarFixtureDesdeAPI". Todo fixture cargado por
// esta vía siempre trae "af_<id>", así que ese camino era código muerto
// en la práctica; si algún día se necesita, se puede reintroducir.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { TORNEOS_SYNC } from "../_shared/torneosSync.ts";

const APIFOOTBALL_BASE = "https://v3.football.api-sports.io";
// Estados de api-football.com: NS (no iniciado), 1H/HT/2H/ET/BT/P (en
// juego), FT/AET/PEN (terminado). https://www.api-football.com/documentation-v3
const ESTADOS_TERMINADO = new Set(["FT", "AET", "PEN"]);
const ESTADOS_EN_JUEGO = new Set(["1H", "HT", "2H", "ET", "BT", "P"]);

function idAPIFootball(fixtureId: string): number | null {
  const m = /^af_(\d+)$/.exec(fixtureId);
  return m ? Number(m[1]) : null;
}
function esPlaceholder(home: string, away: string): boolean {
  const prefijos = ["Por definir", "Ganador", "Perdedor"];
  return prefijos.some((p) => home.startsWith(p) || away.startsWith(p));
}

async function sincronizarTorneo(
  db: SupabaseClient,
  torneoId: string,
  leagueId: number,
  season: number,
  apiKey: string,
) {
  const { data: fixtureRows } = await db
    .from("fixtures")
    .select("match_id, home, away")
    .eq("torneo_id", torneoId);
  const fixtureActual = fixtureRows ?? [];
  if (!fixtureActual.length) {
    return { error: `La malla de "${torneoId}" está vacía -- corre la carga de fixture (subtarea 07) primero.`, sincronizados: 0, enVivo: 0, limpiados: 0, total: 0, sinMapear: [] as string[] };
  }

  const url = `${APIFOOTBALL_BASE}/fixtures?league=${leagueId}&season=${season}`;
  let apiMatches: any[];
  try {
    const resp = await fetch(url, { headers: { "x-apisports-key": apiKey } });
    if (resp.status !== 200) {
      return { error: `Error API (HTTP ${resp.status})`, sincronizados: 0, enVivo: 0, limpiados: 0, total: fixtureActual.length, sinMapear: [] as string[] };
    }
    const parsed = await resp.json();
    if (parsed.errors && Object.keys(parsed.errors).length) {
      return { error: `API respondió con error: ${JSON.stringify(parsed.errors)}`, sincronizados: 0, enVivo: 0, limpiados: 0, total: fixtureActual.length, sinMapear: [] as string[] };
    }
    apiMatches = parsed.response ?? [];
  } catch (err) {
    return { error: `Error consultando la API: ${err}`, sincronizados: 0, enVivo: 0, limpiados: 0, total: fixtureActual.length, sinMapear: [] as string[] };
  }

  const idxIdFinished = new Map<number, any>();
  const idxIdEnJuego = new Map<number, any>();
  const idxIdTodos = new Map<number, any>();
  for (const m of apiMatches) {
    idxIdTodos.set(m.fixture.id, m);
    if (ESTADOS_TERMINADO.has(m.fixture.status.short)) idxIdFinished.set(m.fixture.id, m);
    else if (ESTADOS_EN_JUEGO.has(m.fixture.status.short)) idxIdEnJuego.set(m.fixture.id, m);
  }

  const ahoraISO = new Date().toISOString();
  const upserts: Record<string, unknown>[] = [];
  const aLimpiar: string[] = [];
  const sinMapear: string[] = [];

  for (const m of fixtureActual) {
    if (esPlaceholder(m.home, m.away)) continue;
    const apiId = idAPIFootball(m.match_id);
    if (apiId == null) {
      sinMapear.push(`${m.home} vs ${m.away} (id ${m.match_id}, formato de id inesperado)`);
      continue;
    }

    const pFin = idxIdFinished.get(apiId);
    if (pFin) {
      upserts.push({
        torneo_id: torneoId, match_id: m.match_id,
        home_score: pFin.goals.home ?? 0, away_score: pFin.goals.away ?? 0,
        status: null, minute: null, synced_at: ahoraISO,
      });
      continue;
    }
    const pLive = idxIdEnJuego.get(apiId);
    if (pLive) {
      upserts.push({
        torneo_id: torneoId, match_id: m.match_id,
        home_score: pLive.goals.home ?? 0, away_score: pLive.goals.away ?? 0,
        status: pLive.fixture.status.short, minute: pLive.fixture.status.elapsed ?? null, synced_at: ahoraISO,
      });
      continue;
    }
    if (idxIdTodos.has(apiId)) {
      // La API confirma que este partido aún no se juega (o se
      // pospuso) -- si había un resultado guardado de antes, se limpia.
      aLimpiar.push(m.match_id);
    }
    // apiId válido pero la API no devolvió nada para él -- no tocar
    // nada, podría ser un hueco temporal de la API.
  }

  if (upserts.length) {
    const { error } = await db.from("fixture_results").upsert(upserts, { onConflict: "torneo_id,match_id" });
    if (error) {
      return { error: `Error guardando resultados: ${error.message}`, sincronizados: 0, enVivo: 0, limpiados: 0, total: fixtureActual.length, sinMapear };
    }
  }

  let limpiados = 0;
  if (aLimpiar.length) {
    const { error, count } = await db
      .from("fixture_results")
      .delete({ count: "exact" })
      .eq("torneo_id", torneoId)
      .in("match_id", aLimpiar);
    if (!error) limpiados = count ?? 0;
  }

  return {
    error: null as string | null,
    sincronizados: upserts.filter((u) => u.status === null).length,
    enVivo: upserts.filter((u) => u.status !== null).length,
    limpiados,
    total: fixtureActual.length,
    sinMapear,
  };
}

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  const apiKey = Deno.env.get("APIFOOTBALL_KEY") || "";
  if (!apiKey) return jsonOut({ status: "error", message: "Falta configurar APIFOOTBALL_KEY como secreto de Supabase." });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const resumen = { sincronizados: 0, enVivo: 0, limpiados: 0, total: 0, sinMapear: [] as string[], errores: [] as string[] };

  for (const [torneoId, cfg] of Object.entries(TORNEOS_SYNC)) {
    const r = await sincronizarTorneo(db, torneoId, cfg.leagueId, cfg.season, apiKey);
    resumen.total += r.total;
    if (r.error) { resumen.errores.push(`${torneoId}: ${r.error}`); continue; }
    resumen.sincronizados += r.sincronizados;
    resumen.enVivo += r.enVivo;
    resumen.limpiados += r.limpiados;
    resumen.sinMapear.push(...r.sinMapear.map((s) => `${torneoId}: ${s}`));
  }

  // Equivalente al log que dejaba cronSincronizarResultados() en las
  // Ejecuciones de Apps Script -- aquí aparece en Supabase → Edge
  // Functions → sincronizar-resultados → Logs.
  console.log(JSON.stringify(resumen));

  return jsonOut({ status: "success", ...resumen });
});
