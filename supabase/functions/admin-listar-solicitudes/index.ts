// Lista las solicitudes de grupo pendientes de revisión (ver
// solicitar-grupo) para que el administrador central las vea en Panel
// Central y cree el grupo correspondiente con los datos ya en mano.
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
      .from("group_requests")
      .select("id, grupo_id, nombre_grupo, torneo_id, modo_seguimiento, equipos_seguidos, nombre_admin, celular_admin, correo_admin, pin_deseado, created_at, estado_pago")
      .eq("estado", "pendiente")
      .order("created_at", { ascending: true });
    if (error) return errOut("admin-listar-solicitudes", error);

    return jsonOut({
      status: "success",
      solicitudes: (data ?? []).map((s) => ({
        id: s.id,
        grupoId: s.grupo_id,
        nombreGrupo: s.nombre_grupo,
        torneoId: s.torneo_id,
        modoSeguimiento: s.modo_seguimiento,
        equiposSeguidos: s.equipos_seguidos,
        nombreAdmin: s.nombre_admin,
        celularAdmin: s.celular_admin,
        correoAdmin: s.correo_admin,
        pinDeseado: s.pin_deseado,
        fechaSolicitud: s.created_at,
        estadoPago: s.estado_pago,
      })),
    });
  } catch (err) {
    return errOut("admin-listar-solicitudes", err);
  }
});
