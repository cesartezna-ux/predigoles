// Equivalente de action==="loginOrganizador" en Code.gs. Antes el
// navegador comparaba el PIN localmente leyendo adminPin de getAll --
// ahora, igual que en Code.gs, el hash nunca sale de group_secrets y la
// comparación siempre ocurre en el servidor.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, pin } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkAdminAuth(db, String(tab), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);
    return jsonOut({ status: "success" });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
