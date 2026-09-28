// Equivalente de action==="adminActualizarPago" en Code.gs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { masterPin, grupoId, estadoPago } = await req.json();
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    if (!grupoId || !estadoPago) return jsonOut({ status: "error", message: "Faltan datos." });
    if (!["Pendiente", "Pagado", "Cortesía"].includes(String(estadoPago))) {
      return jsonOut({ status: "error", message: "Estado de pago inválido." });
    }

    const { data, error } = await db
      .from("groups")
      .update({ estado_pago: String(estadoPago) })
      .eq("id", String(grupoId))
      .select("id");
    if (error) return errOut("admin-actualizar-pago", error);
    if (!data || data.length === 0) {
      return jsonOut({ status: "error", message: "Grupo no encontrado en el registro maestro." });
    }

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("admin-actualizar-pago", err);
  }
});
