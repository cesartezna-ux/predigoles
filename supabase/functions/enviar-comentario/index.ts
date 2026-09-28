// Recibe un comentario del botón flotante (visible en el Home y en la app,
// para jugadores y organizadores). Público (sin PIN) a propósito -- dejar
// un comentario debe ser fricción cero -- por eso valida cada campo a
// fondo y limita cuántas veces se puede llamar seguido, mismo patrón que
// solicitar-grupo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { sanitizeTab } from "../_shared/validate.ts";
import { rateLimitCheck, rateLimitRegistrarFallo } from "../_shared/rateLimit.ts";
import { errOut } from "../_shared/errOut.ts";

const ORIGENES_VALIDOS = new Set(["landing", "jugador", "organizador"]);

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "sin-ip";
    const identidad = "enviar-comentario_" + ip;
    const bloqueo = await rateLimitCheck(db, identidad);
    if (bloqueo) return jsonOut(bloqueo);
    await rateLimitRegistrarFallo(db, identidad); // cuenta cada envío, no solo los fallidos

    const body = await req.json();

    const origen = String(body.origen || "");
    if (!ORIGENES_VALIDOS.has(origen)) return jsonOut({ status: "error", message: "Origen inválido." });

    const mensaje = String(body.mensaje || "").trim().slice(0, 2000);
    if (!mensaje) return jsonOut({ status: "error", message: "Escribe algo antes de enviar." });

    let grupoId: string | null = null;
    if (body.grupoId != null) {
      grupoId = sanitizeTab(body.grupoId);
      if (!grupoId) return jsonOut({ status: "error", message: "grupoId inválido." });
    }

    const autorNombre = body.autorNombre != null ? String(body.autorNombre).trim().slice(0, 60) || null : null;

    const { error } = await db.from("feedback").insert({
      origen,
      grupo_id: grupoId,
      autor_nombre: autorNombre,
      mensaje,
    });
    if (error) return errOut("enviar-comentario", error);

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("enviar-comentario", err);
  }
});
