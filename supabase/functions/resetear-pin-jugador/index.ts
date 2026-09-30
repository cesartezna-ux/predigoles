// Equivalente de action==="resetearPinJugador" en Code.gs -- función del
// organizador (exige su PIN), distinta de admin-resetear-pin (esa resetea
// el PIN del propio organizador, desde Panel Central).
//
// DECISIÓN DE DISEÑO (revisado 30/09/2026): antes dejaba pin_hash en null
// y "el primer que entre" quedaba dueño del PIN nuevo -- eso abría una
// ventana real: cualquiera con acceso al roster (ej. alguien más del
// grupo, un hermano en el mismo celular) podía entrar antes que el
// jugador legítimo y robarse su cuenta. Ahora siempre asigna un PIN
// concreto de una vez (el que pida el organizador, o uno generado al
// azar) -- igual que ya hace admin-resetear-pin -- así el organizador
// se lo entrega directo al jugador y no queda ninguna ventana abierta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";
import { hashPin } from "../_shared/hashPin.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, pin, playerId, pinNuevo } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });
    if (!playerId) return jsonOut({ status: "error", message: "playerId requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkAdminAuth(db, String(tab), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);

    let pinFinal = String(pinNuevo || "").trim();
    if (!pinFinal) pinFinal = String(Math.floor(1000 + Math.random() * 9000));
    if (!/^\d{4}$/.test(pinFinal)) return jsonOut({ status: "error", message: "El PIN debe ser de 4 dígitos." });

    const { data, error } = await db
      .from("players")
      .update({ pin_hash: hashPin(pinFinal) })
      .eq("group_id", tab)
      .eq("id", playerId)
      .select("id");
    if (error) return errOut("resetear-pin-jugador", error);
    if (!data || data.length === 0) {
      return jsonOut({ status: "error", message: "Jugador no encontrado en este grupo." });
    }

    return jsonOut({ status: "success", pin: pinFinal });
  } catch (err) {
    return errOut("resetear-pin-jugador", err);
  }
});
