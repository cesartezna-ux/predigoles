// Equivalente de action==="adminListarGrupos" en Code.gs. Antes vivía
// en una hoja aparte (_grupos_maestro); aquí es la misma tabla groups
// que ya usa el resto del sistema -- ya no hace falta mantener un
// registro duplicado sincronizado a mano con las escrituras normales.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";

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

    const { data: grupos, error } = await db
      .from("groups")
      .select("id, name, admin_nombre, admin_celular, admin_correo, torneo_id, created_at, estado_pago")
      .order("created_at", { ascending: false });
    if (error) return jsonOut({ status: "error", message: String(error.message) });

    return jsonOut({
      status: "success",
      grupos: (grupos ?? []).map((g) => ({
        grupoId: g.id,
        nombreGrupo: g.name,
        nombreAdmin: g.admin_nombre,
        celularAdmin: g.admin_celular,
        correoAdmin: g.admin_correo,
        torneoId: g.torneo_id,
        fechaCreacion: g.created_at,
        estadoPago: g.estado_pago,
      })),
    });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
