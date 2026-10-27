// Recibe el evento SALE_APPROVED que envía Bold cuando se aprueba un pago
// (link de pago). Público por naturaleza (Bold lo llama servidor a
// servidor, sin pasar por el navegador del comprador), así que NUNCA se
// confía en su contenido sin antes verificar la firma -- mismo principio
// que wompi-webhook, verificación distinta porque Bold firma distinto.
//
// Verificación (documentada por Bold): Base64 del cuerpo crudo de la
// petición, HMAC-SHA256 de esa cadena con la llave secreta, resultado en
// hexadecimal, comparar contra el header "x-bold-signature". Por eso se
// lee el body como texto ANTES de parsearlo como JSON -- una vez
// consumido como JSON, el texto crudo ya no está disponible.
//
// La referencia del pago es el id de la solicitud (ver crear-pago-bold) --
// así se sabe a cuál group_requests corresponde un pago aprobado. Mismo
// flujo de autoprovisión de punta a punta que wompi-webhook: en cuanto se
// confirma el pago, este webhook crea el grupo y manda el correo de
// bienvenida, con el mismo respaldo manual en Panel Central si algo falla
// en ese tramo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { provisionarGrupo } from "../_shared/provisionarGrupo.ts";
import { notificarAdminPorCorreo } from "../_shared/notificarAdmin.ts";
import { errOut } from "../_shared/errOut.ts";

// btoa() falla si el string contiene cualquier carácter fuera de Latin1
// (emoji, CJK, etc.) -- plausible en campos como cardholder_name. Se
// convierte cada byte crudo a su char code (siempre 0-255, válido para
// btoa) en vez de pasarle el texto decodificado como UTF-8.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function hmacSha256Hex(secret: string, base64Body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base64Body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparación de tiempo constante -- evita que un atacante deduzca la
// firma correcta byte a byte midiendo cuánto tarda cada intento fallido.
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const secretKey = Deno.env.get("BOLD_SECRET_KEY") || "";
    if (!secretKey) {
      console.error("[bold-webhook] BOLD_SECRET_KEY no configurado -- evento rechazado.");
      return jsonOut({ status: "error", message: "No configurado." });
    }

    const rawBytes = new Uint8Array(await req.arrayBuffer());
    const rawBody = new TextDecoder().decode(rawBytes);
    const firmaRecibida = req.headers.get("x-bold-signature") || "";
    const base64Body = bytesToBase64(rawBytes);
    const firmaCalculada = await hmacSha256Hex(secretKey, base64Body);

    if (!firmaRecibida || !iguales(firmaCalculada.toLowerCase(), firmaRecibida.toLowerCase())) {
      console.error("[bold-webhook] Firma inválida -- evento descartado.");
      return jsonOut({ status: "error", message: "Firma inválida." });
    }

    const body = JSON.parse(rawBody);
    if (body?.type !== "SALE_APPROVED") {
      // Rechazado, anulación, etc. -- no hay nada que activar.
      return jsonOut({ status: "success", ignorado: true });
    }

    const reference = String(body?.data?.metadata?.reference || "");
    const paymentId = String(body?.data?.payment_id || "");
    if (!reference) return jsonOut({ status: "error", message: "Transacción sin referencia." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: solicitud, error } = await db
      .from("group_requests")
      .update({ estado_pago: "pagado", bold_payment_id: paymentId })
      .eq("id", reference)
      .select("id, estado, grupo_id, nombre_grupo, torneo_id, modo_seguimiento, equipos_seguidos, nombre_admin, celular_admin, correo_admin, ciudad_admin, pin_deseado")
      .maybeSingle();
    if (error) return errOut("bold-webhook", error);

    // Si el admin central ya la atendió a mano (posible con un reintento de
    // Bold, o una coincidencia de tiempos) no se vuelve a crear el grupo ni
    // se reenvía el correo -- provisionarGrupo() igual lo bloquearía por
    // "grupo ya configurado", pero conviene no ni intentarlo.
    if (solicitud && solicitud.estado === "pendiente") {
      let resultado: Awaited<ReturnType<typeof provisionarGrupo>> | null = null;
      try {
        resultado = await provisionarGrupo(db, {
          grupoId: solicitud.grupo_id,
          nombreGrupo: solicitud.nombre_grupo,
          torneoId: solicitud.torneo_id,
          modoSeguimiento: solicitud.modo_seguimiento,
          equiposSeguidos: solicitud.equipos_seguidos,
          nombreAdmin: solicitud.nombre_admin,
          celularAdmin: solicitud.celular_admin,
          correoAdmin: solicitud.correo_admin,
          ciudadAdmin: solicitud.ciudad_admin,
          pin: solicitud.pin_deseado,
          estadoPago: "Pagado",
        });
      } catch (errProvision) {
        console.error("[bold-webhook] Error creando el grupo automáticamente -- queda pendiente para creación manual.", {
          solicitudId: solicitud.id,
          err: String(errProvision),
        });
      }

      if (resultado?.status === "success") {
        await db.from("group_requests").update({ estado: "atendida" }).eq("id", solicitud.id);
        if (solicitud.correo_admin) {
          try {
            await notificarAdminPorCorreo({
              grupoId: resultado.grupoId,
              nombreGrupo: solicitud.nombre_grupo,
              nombreAdmin: solicitud.nombre_admin,
              correoAdmin: solicitud.correo_admin,
              pin: resultado.pin,
            });
          } catch (errCorreo) {
            console.error("[bold-webhook] Grupo creado pero el correo de bienvenida falló.", {
              solicitudId: solicitud.id,
              grupoId: resultado.grupoId,
              err: String(errCorreo),
            });
          }
        }
      } else if (resultado?.status === "error") {
        console.error("[bold-webhook] No se pudo autoprovisionar el grupo -- queda pendiente para creación manual.", {
          solicitudId: solicitud.id,
          message: resultado.message,
        });
      }
    }

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("bold-webhook", err);
  }
});
