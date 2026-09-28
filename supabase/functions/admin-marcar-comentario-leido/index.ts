// Marca un comentario (ver enviar-comentario) como leído, para que deje de
// listarse en Panel Central. No lo borra -- queda como historial.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { masterPin, comentarioId } = await req.json();
    if (!comentarioId) return jsonOut({ status: "error", message: "comentarioId requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const { error } = await db
      .from("feedback")
      .update({ estado: "leido" })
      .eq("id", String(comentarioId));
    if (error) return errOut("admin-marcar-comentario-leido", error);

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("admin-marcar-comentario-leido", err);
  }
});
