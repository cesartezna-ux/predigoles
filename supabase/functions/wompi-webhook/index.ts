// Recibe el evento "transaction.updated" que envía Wompi cuando cambia el
// estado de un pago. Público por naturaleza (Wompi lo llama servidor a
// servidor, sin pasar por el navegador del comprador), así que NUNCA se
// confía en su contenido sin antes verificar la firma -- cualquiera podría
// mandar un POST fingiendo un pago aprobado si no se validara esto.
//
// Verificación (documentada por Wompi): concatenar los valores de
// signature.properties en el orden dado, agregar el timestamp del evento,
// agregar el secreto de eventos, SHA256, comparar contra signature.checksum.
//
// La referencia del pago es el id de la solicitud (ver crear-pago-wompi) --
// así se sabe a cuál group_requests corresponde un pago aprobado.
//
// Automatización de punta a punta (2/10/2026): en cuanto se confirma el
// pago, este mismo webhook crea el grupo y manda el correo de bienvenida --
// cero clics del admin central. Si algo falla en ese tramo (grupoId ya
// tomado, SMTP caído, etc.), la solicitud queda "pendiente" igual que
// siempre: el botón "Crear grupo con estos datos" en Panel Central sigue
// ahí como respaldo manual. Lo único que SIEMPRE se confirma aquí, pase lo
// que pase después, es que el pago en sí quedó registrado -- esa es la
// parte crítica que no puede fallar en silencio.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { provisionarGrupo } from "../_shared/provisionarGrupo.ts";
import { notificarAdminPorCorreo } from "../_shared/notificarAdmin.ts";
import { errOut } from "../_shared/errOut.ts";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function leerRuta(obj: unknown, ruta: string): unknown {
  return ruta.split(".").reduce((acc: any, p) => acc?.[p], obj);
}

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const eventsSecret = Deno.env.get("WOMPI_EVENTS_SECRET") || "";
    if (!eventsSecret) {
      console.error("[wompi-webhook] WOMPI_EVENTS_SECRET no configurado -- evento rechazado.");
      return jsonOut({ status: "error", message: "No configurado." });
    }

    const body = await req.json();
    const sig = body?.signature;
    const tx = body?.data?.transaction;
    if (!sig || !Array.isArray(sig.properties) || !sig.checksum || !tx) {
      return jsonOut({ status: "error", message: "Payload inválido." });
    }

    let base = "";
    for (const ruta of sig.properties) {
      base += String(leerRuta(body.data, String(ruta).replace(/^data\./, "")) ?? "");
    }
    base += String(body.timestamp ?? "");
    base += eventsSecret;
    const checksumCalculado = await sha256Hex(base);

    if (checksumCalculado.toLowerCase() !== String(sig.checksum).toLowerCase()) {
      console.error("[wompi-webhook] Firma inválida -- evento descartado.", { reference: tx.reference });
      return jsonOut({ status: "error", message: "Firma inválida." });
    }

    if (tx.status !== "APPROVED") {
      // Declinado, pendiente, error, etc. -- no hay nada que activar.
      return jsonOut({ status: "success", ignorado: true });
    }

    if (!tx.reference) return jsonOut({ status: "error", message: "Transacción sin referencia." });

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: solicitud, error } = await db
      .from("group_requests")
      .update({ estado_pago: "pagado", wompi_transaction_id: String(tx.id ?? "") })
      .eq("id", String(tx.reference))
      .select("id, estado, grupo_id, nombre_grupo, torneo_id, modo_seguimiento, equipos_seguidos, nombre_admin, celular_admin, correo_admin, pin_deseado")
      .maybeSingle();
    if (error) return errOut("wompi-webhook", error);

    // Si el admin central ya la atendió a mano (posible con un reintento de
    // Wompi, o una coincidencia de tiempos) no se vuelve a crear el grupo
    // ni se reenvía el correo -- provisionarGrupo() igual lo bloquearía por
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
          pin: solicitud.pin_deseado,
          estadoPago: "Pagado",
        });
      } catch (errProvision) {
        console.error("[wompi-webhook] Error creando el grupo automáticamente -- queda pendiente para creación manual.", {
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
            // El grupo ya quedó creado -- esto no debe revertir nada. Si el
            // admin central necesita reenviar el link+PIN, "Resetear PIN"
            // en Panel Central genera uno nuevo y ofrece el mismo botón de
            // notificar por correo.
            console.error("[wompi-webhook] Grupo creado pero el correo de bienvenida falló.", {
              solicitudId: solicitud.id,
              grupoId: resultado.grupoId,
              err: String(errCorreo),
            });
          }
        }
      } else if (resultado?.status === "error") {
        console.error("[wompi-webhook] No se pudo autoprovisionar el grupo -- queda pendiente para creación manual.", {
          solicitudId: solicitud.id,
          message: resultado.message,
        });
      }
    }

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("wompi-webhook", err);
  }
});
