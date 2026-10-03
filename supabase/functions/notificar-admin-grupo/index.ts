// Envía al admin de un grupo, por correo (SMTP de contacto@predigoles.com
// en GoDaddy), el link, el PIN y las instrucciones básicas de uso. Se llama
// desde el mismo modal donde se muestra el PIN en texto plano por primera
// vez (ver mostrarGrupoCreado() en index.html), o automáticamente desde
// wompi-webhook justo después de crear el grupo -- es la única oportunidad:
// el backend nunca vuelve a tener el PIN en texto plano después de esto,
// solo el hash. La lógica real vive en _shared/notificarAdmin.ts.
//
// Acción del administrador central (requiere PIN maestro) cuando se llama
// aquí -- nunca se dispara sola desde el frontend sin un clic explícito.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { sanitizeTab } from "../_shared/validate.ts";
import { notificarAdminPorCorreo } from "../_shared/notificarAdmin.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { masterPin, grupoId, nombreGrupo, nombreAdmin, correoAdmin, pin } = await req.json();

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const idLimpio = sanitizeTab(grupoId);
    if (!idLimpio) return jsonOut({ status: "error", message: "ID de grupo inválido." });

    const resultado = await notificarAdminPorCorreo({ grupoId: idLimpio, nombreGrupo, nombreAdmin, correoAdmin, pin });
    if (resultado.status === "success") console.log("[notificar-admin-grupo] Correo enviado para grupo", idLimpio);
    return jsonOut(resultado);
  } catch (err) {
    return errOut("notificar-admin-grupo", err);
  }
});
