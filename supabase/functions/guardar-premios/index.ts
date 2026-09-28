// Equivalente de guardar "betting" en Code.gs (showBettingConfig()) --
// info puramente informativa: la app nunca recauda ni mueve dinero, cada
// jugador le transfiere directo al ganador según este reparto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkAdminAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

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

    const inscripcionNum = Number(inscripcion) || 0;
    const p1 = Number(premios?.p1) || 0;
    const p2 = Number(premios?.p2) || 0;
    const p3 = Number(premios?.p3) || 0;

    // El cliente ya valida esto, pero un llamado directo a la API (sin pasar
    // por la UI) podría mandar cualquier cosa -- ej. el bug real que motivó
    // esta validación: 70000/30000 en vez de 70/30, que multiplicaba el
    // reparto mostrado por 1000 frente al bote total real.
    if (inscripcionNum < 0) {
      return jsonOut({ status: "error", message: "El monto de inscripción no puede ser negativo." });
    }
    if (p1 < 0 || p1 > 100 || p2 < 0 || p2 > 100 || p3 < 0 || p3 > 100) {
      return jsonOut({ status: "error", message: "Los porcentajes de premio deben estar entre 0 y 100." });
    }
    const suma = p1 + p2 + p3;
    if (suma !== 0 && suma !== 100) {
      return jsonOut({ status: "error", message: "Los porcentajes de premio deben sumar 100 (o dejarlos todos en 0 si aún no se define el reparto)." });
    }

    const betting = { inscripcion: inscripcionNum, premios: { p1, p2, p3 } };

    const { error } = await db.from("groups").update({ betting }).eq("id", tab);
    if (error) return errOut("guardar-premios", error);

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("guardar-premios", err);
  }
});
