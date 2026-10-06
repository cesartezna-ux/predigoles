// Registra un pronóstico del demo público (ver _shared/demo.ts). Solo acepta
// partidos en vivo. Sin PIN, así que se protege con límite por IP, un apodo
// por partido, una entrada por navegador y partido, y un cupo máximo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { rateLimitCheck, rateLimitRegistrarFallo } from "../_shared/rateLimit.ts";
import { apodoValido, CUPO_POR_PARTIDO, EMOJIS_DEMO, marcadorValido, partidoDemo } from "../_shared/demo.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "sin-ip";
    const identidad = "demo-pronosticar_" + ip;
    const bloqueo = await rateLimitCheck(db, identidad);
    if (bloqueo) return jsonOut(bloqueo);
    await rateLimitRegistrarFallo(db, identidad);

    const body = await req.json();

    const apodo = apodoValido(String(body.apodo ?? ""));
    if (!apodo) return jsonOut({ status: "error", message: "Elige un apodo de 2 a 20 letras o números, sin apellidos ni groserías." });

    const emoji = String(body.emoji ?? "");
    if (!EMOJIS_DEMO.includes(emoji)) return jsonOut({ status: "error", message: "Elige un emoji de la lista." });

    const home = marcadorValido(body.homeScore);
    const away = marcadorValido(body.awayScore);
    if (home === null || away === null) return jsonOut({ status: "error", message: "El marcador debe ser de 0 a 9." });

    const navegadorId = String(body.navegadorId ?? "");
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(navegadorId)) return jsonOut({ status: "error", message: "Recarga la página e intenta de nuevo." });

    const partido = await partidoDemo(db);
    if (!partido || !partido.enVivo) {
      return jsonOut({ status: "error", message: "Ahora mismo no hay partido en vivo en el demo. Vuelve cuando empiece el siguiente." });
    }

    const { count } = await db
      .from("demo_pronosticos")
      .select("id", { count: "exact", head: true })
      .eq("match_id", partido.matchId);
    if ((count ?? 0) >= CUPO_POR_PARTIDO) {
      return jsonOut({ status: "error", message: "El demo de este partido ya está lleno. Pronto empieza el siguiente." });
    }

    const { data: yaParticipo } = await db
      .from("demo_pronosticos")
      .select("id")
      .eq("match_id", partido.matchId)
      .eq("navegador_id", navegadorId)
      .maybeSingle();
    if (yaParticipo) {
      return jsonOut({ status: "ya_participo", message: "Ya participaste en este partido. ¿Quieres jugar en serio con tu grupo?" });
    }

    const { error } = await db.from("demo_pronosticos").insert({
      torneo_id: partido.torneoId,
      match_id: partido.matchId,
      apodo,
      emoji,
      home_score: home,
      away_score: away,
      navegador_id: navegadorId,
    });
    if (error) {
      if (error.code === "23505") {
        if (String(error.message).includes("demo_apodo_por_partido")) {
          return jsonOut({ status: "error", message: "Ese apodo ya está en este partido. Prueba con otro." });
        }
        return jsonOut({ status: "ya_participo", message: "Ya participaste en este partido. ¿Quieres jugar en serio con tu grupo?" });
      }
      return errOut("demo-pronosticar", error);
    }

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("demo-pronosticar", err);
  }
});
