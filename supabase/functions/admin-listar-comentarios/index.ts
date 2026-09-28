// Lista los comentarios nuevos (ver enviar-comentario) para Panel Central.
// Solo trae "nuevo" -- los ya leídos no se listan más (quedan en la tabla
// como historial, pero no hace falta seguir viéndolos cada vez que entras).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { masterPin } = await req.json();
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const { data, error } = await db
      .from("feedback")
      .select("id, origen, grupo_id, autor_nombre, mensaje, created_at")
      .eq("estado", "nuevo")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return errOut("admin-listar-comentarios", error);

    return jsonOut({
      status: "success",
      comentarios: (data ?? []).map((c) => ({
        id: c.id,
        origen: c.origen,
        grupoId: c.grupo_id,
        autorNombre: c.autor_nombre,
        mensaje: c.mensaje,
        fecha: c.created_at,
      })),
    });
  } catch (err) {
    return errOut("admin-listar-comentarios", err);
  }
});
