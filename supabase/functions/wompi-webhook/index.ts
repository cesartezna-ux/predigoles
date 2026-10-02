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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
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

    const { error } = await db
      .from("group_requests")
      .update({ estado_pago: "pagado", wompi_transaction_id: String(tx.id ?? "") })
      .eq("id", String(tx.reference));
    if (error) return errOut("wompi-webhook", error);

    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("wompi-webhook", err);
  }
});
