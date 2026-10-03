// Elimina un grupo por completo. jugadores, pronósticos, partidos
// personalizados y el PIN del grupo se van con él por "on delete cascade"
// (ver groups en schema.sql) -- no hace falta borrarlos aparte. Pensado
// sobre todo para limpiar grupos de prueba; el tipeo del nombre exacto para
// confirmar vive en el frontend (fricción contra un clic accidental), la
// autoridad real aquí es el PIN maestro, igual que cualquier otra acción de
// Panel Central.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { masterPin, grupoId } = await req.json();
    if (!grupoId) return jsonOut({ status: "error", message: "grupoId requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const { error } = await db.from("groups").delete().eq("id", String(grupoId));
    if (error) return errOut("admin-eliminar-grupo", error);

    console.log("[admin-eliminar-grupo] Grupo eliminado:", grupoId);
    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("admin-eliminar-grupo", err);
  }
});
