// Marca una solicitud de grupo (ver solicitar-grupo) como atendida, para
// que deje de listarse en "Solicitudes pendientes" de Panel Central. No
// borra el registro -- queda como historial de qué se pidió y cuándo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { masterPin, solicitudId } = await req.json();
    if (!solicitudId) return jsonOut({ status: "error", message: "solicitudId requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const { error } = await db
      .from("group_requests")
      .update({ estado: "atendida" })
      .eq("id", String(solicitudId));
    if (error) return jsonOut({ status: "error", message: String(error.message) });

    return jsonOut({ status: "success" });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
