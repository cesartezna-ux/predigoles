// Equivalente de action==="adminProvisionarGrupo" en Code.gs. Sigue sin
// existir "primer set libre": todo grupo nace por esta función (llamada
// aquí con PIN maestro, o automáticamente desde wompi-webhook cuando Wompi
// confirma un pago), nunca por autoconfiguración espontánea de quien abra
// el link primero. La lógica real vive en _shared/provisionarGrupo.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { provisionarGrupo } from "../_shared/provisionarGrupo.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const {
      masterPin, grupoId, nombreGrupo, torneoId, modoSeguimiento, equiposSeguidos,
      nombreAdmin, celularAdmin, correoAdmin, pin, estadoPago,
    } = await req.json();

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const resultado = await provisionarGrupo(db, {
      grupoId, nombreGrupo, torneoId, modoSeguimiento, equiposSeguidos,
      nombreAdmin, celularAdmin, correoAdmin, pin, estadoPago,
    });
    return jsonOut(resultado);
  } catch (err) {
    return errOut("admin-provisionar-grupo", err);
  }
});
