// Equivalente de action==="guardarSeguimiento" en Code.gs. Sigue siendo
// una sola escritura atómica (modo + equipos juntos) -- la razón original
// de por qué se unificó en una sola petición en Code.gs (evitar que un
// hipo de red deje el grupo a medias) sigue aplicando igual aquí.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, modoSeguimiento, equiposSeguidos, pin } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkAdminAuth(db, String(tab), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);

    const modo = modoSeguimiento === "equipo" ? "equipo" : "torneo";
    const arr = Array.isArray(equiposSeguidos) ? equiposSeguidos : [];
    const equipos = arr.slice(0, 40).map((e: unknown) => String(e ?? "").slice(0, 60)).filter(Boolean);

    const { error } = await db
      .from("groups")
      .update({ modo_seguimiento: modo, equipos_seguidos: equipos })
      .eq("id", tab);
    if (error) return errOut("guardar-seguimiento", error);

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("guardar-seguimiento", err);
  }
});
