// Equivalente de action==="loginJugador" en Code.gs -- incluye el
// autoregistro (primera vez que ese playerId inicia sesión, se guarda
// el PIN que envía y queda como dueño de esa identidad).
//
// DECISIÓN DE DISEÑO respecto a Code.gs: allá, "pin_<playerId>" era una
// clave KV totalmente independiente de "roster" -- podía existir un PIN
// sin que el jugador estuviera en el roster, o viceversa. Aquí, con una
// tabla players real, esa fila tiene que existir primero (creada por la
// función de "unirse al grupo" de la subtarea 03, equivalente a
// joinRoster). Si el playerId no existe todavía en este grupo, esta
// función responde con un error explícito en vez de crear la fila a
// ciegas -- separa correctamente "unirse a un grupo" de "autenticarse",
// que en el modelo viejo estaban mezclados sin querer.
// ⚠️ Pendiente para la subtarea 08 (reconexión del frontend): el
// frontend debe llamar a "unirse al grupo" ANTES que a este login, no
// después como hace hoy con joinRoster().
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { rateLimitCheck, rateLimitRegistrarFallo, rateLimitRegistrarExito } from "../_shared/rateLimit.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, playerId, pin } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });
    if (!playerId) return jsonOut({ status: "error", message: "playerId requerido." });
    const pinEnviado = pin ? String(pin) : "";
    if (!pinEnviado) return jsonOut({ status: "error", message: "PIN requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Mismo esquema de identidad que checkPlayerAuth, para que ambos
    // caminos de verificación del PIN de un jugador compartan el mismo
    // cupo de intentos (si no, bastaría atacar por acá para esquivar el
    // límite) -- igual razonamiento que en Code.gs.
    const identidad = "player_" + tab + "_" + playerId;
    const bloqueo = await rateLimitCheck(db, identidad);
    if (bloqueo) return jsonOut(bloqueo);

    const { data: jugador } = await db
      .from("players")
      .select("pin_hash")
      .eq("group_id", tab)
      .eq("id", playerId)
      .maybeSingle();

    if (!jugador) {
      return jsonOut({ status: "error", message: "Jugador no encontrado en este grupo -- únete primero." });
    }

    if (!jugador.pin_hash) {
      const { error } = await db
        .from("players")
        .update({ pin_hash: pinEnviado })
        .eq("group_id", tab)
        .eq("id", playerId);
      if (error) return jsonOut({ status: "error", message: String(error.message) });
      await rateLimitRegistrarExito(db, identidad);
      return jsonOut({ status: "success", nuevo: true });
    }

    if (pinEnviado !== jugador.pin_hash) {
      await rateLimitRegistrarFallo(db, identidad);
      return jsonOut({ status: "error", message: "PIN incorrecto." });
    }

    await rateLimitRegistrarExito(db, identidad);
    return jsonOut({ status: "success", nuevo: false });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
