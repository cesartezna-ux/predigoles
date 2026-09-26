// Equivalente de guardar "betting" en Code.gs (showBettingConfig()) --
// info puramente informativa: la app nunca recauda ni mueve dinero, cada
// jugador le transfiere directo al ganador según este reparto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { tab, pin, inscripcion, premios } = await req.json();
    if (!tab) return jsonOut({ status: "error", message: "tab requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authError = await checkAdminAuth(db, String(tab), pin ? String(pin) : null);
    if (authError) return jsonOut(authError);

    const betting = {
      inscripcion: Number(inscripcion) || 0,
      premios: {
        p1: Number(premios?.p1) || 0,
        p2: Number(premios?.p2) || 0,
        p3: Number(premios?.p3) || 0,
      },
    };

    const { error } = await db.from("groups").update({ betting }).eq("id", tab);
    if (error) return jsonOut({ status: "error", message: String(error.message) });

    return jsonOut({ status: "success" });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
