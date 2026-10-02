// Marca manualmente una solicitud (ver solicitar-grupo) como pagada o
// pendiente. Necesario mientras convive más de un canal de cobro: el
// webhook de Wompi marca "pagado" solo, pero un pago por Gumroad (u otro
// canal manual) no tiene forma de avisarle al sistema -- el admin central
// lo confirma aquí a mano.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { masterPin, solicitudId, estadoPago } = await req.json();
    if (!solicitudId) return jsonOut({ status: "error", message: "solicitudId requerido." });
    if (estadoPago !== "pagado" && estadoPago !== "pendiente") {
      return jsonOut({ status: "error", message: "estadoPago inválido." });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const { error } = await db
      .from("group_requests")
      .update({ estado_pago: estadoPago })
      .eq("id", String(solicitudId));
    if (error) return errOut("admin-marcar-solicitud-pagada", error);

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("admin-marcar-solicitud-pagada", err);
  }
});
