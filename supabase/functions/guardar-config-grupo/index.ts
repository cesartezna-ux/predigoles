// Equivalente de showGroupEdit() en index.html -- en Code.gs esto eran
// DOS peticiones seguidas (setRawAuth("adminPin",...) + setJSONAuth
// ("groupName",...)), con el mismo riesgo que ya se corrigió para
// guardarSeguimiento: un hipo transitorio entre las dos podía dejar el
// grupo a medias (nombre nuevo pero PIN viejo, o viceversa). Aquí es
// una sola petición autenticada; pinNuevo es opcional (el formulario ya
// deja el campo en blanco si no se quiere cambiar el PIN).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";
import { hashPin } from "../_shared/hashPin.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, pin, nombreGrupo, pinNuevo } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });

    const nombre = String(nombreGrupo || "").trim();
    if (!nombre) return jsonOut({ status: "error", message: "El nombre del grupo no puede quedar vacío." });

    const pinNuevoLimpio = pinNuevo ? String(pinNuevo).trim() : "";
    if (pinNuevoLimpio && !/^\d{4}$/.test(pinNuevoLimpio)) {
      return jsonOut({ status: "error", message: "El PIN debe tener 4 dígitos numéricos." });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkAdminAuth(db, String(tab), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);

    const { error: errNombre } = await db.from("groups").update({ name: nombre }).eq("id", tab);
    if (errNombre) return jsonOut({ status: "error", message: String(errNombre.message) });

    let nuevoHash: string | null = null;
    if (pinNuevoLimpio) {
      nuevoHash = hashPin(pinNuevoLimpio);
      const { error: errPin } = await db
        .from("group_secrets")
        .update({ admin_pin_hash: nuevoHash })
        .eq("group_id", tab);
      if (errPin) return jsonOut({ status: "error", message: String(errPin.message) });
    }

    return jsonOut({ status: "success", nuevoPinHash: nuevoHash });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
