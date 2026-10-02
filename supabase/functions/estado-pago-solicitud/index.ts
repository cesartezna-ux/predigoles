// Le permite a /setup confirmar, al volver del checkout de Wompi, si ESE
// pago puntual quedó realmente aprobado -- lo único que lo confirma de
// verdad es wompi-webhook (ya verificó la firma de Wompi antes de marcar
// "pagado"), nunca el simple hecho de haber vuelto a esta URL.
//
// Público (sin PIN): el id de la solicitud es un UUID no adivinable
// (generado por Postgres), y lo único que se expone es un booleano -- nada
// sensible como para justificar autenticación aparte.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { solicitudId } = await req.json();
    if (!solicitudId) return jsonOut({ status: "error", message: "solicitudId requerido." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await db
      .from("group_requests")
      .select("estado_pago")
      .eq("id", String(solicitudId))
      .maybeSingle();
    if (error) return errOut("estado-pago-solicitud", error);

    return jsonOut({ status: "success", pagado: data?.estado_pago === "pagado" });
  } catch (err) {
    return errOut("estado-pago-solicitud", err);
  }
});
