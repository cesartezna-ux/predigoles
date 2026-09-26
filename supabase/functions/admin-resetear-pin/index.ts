// Equivalente de action==="adminResetearPin" en Code.gs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { sanitizeTab } from "../_shared/validate.ts";
import { hashPin } from "../_shared/hashPin.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { masterPin, grupoId, pin } = await req.json();
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const idLimpio = sanitizeTab(grupoId);
    if (!idLimpio) return jsonOut({ status: "error", message: "ID de grupo inválido." });

    const { data: existe } = await db.from("groups").select("id").eq("id", idLimpio).maybeSingle();
    if (!existe) return jsonOut({ status: "error", message: "Ese grupo no existe." });

    let pinFinal = String(pin || "").trim();
    if (!pinFinal) pinFinal = String(Math.floor(1000 + Math.random() * 9000));
    if (!/^\d{4}$/.test(pinFinal)) return jsonOut({ status: "error", message: "El PIN debe ser de 4 dígitos." });

    const { error } = await db.from("group_secrets").upsert({
      group_id: idLimpio,
      admin_pin_hash: hashPin(pinFinal),
    });
    if (error) return jsonOut({ status: "error", message: String(error.message) });

    return jsonOut({ status: "success", grupoId: idLimpio, pin: pinFinal });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
