// Genera los parámetros firmados para redirigir al comprador al Checkout
// Web de Wompi (https://checkout.wompi.co/p/), a partir de una solicitud
// ya guardada por solicitar-grupo. La referencia del pago ES el id de la
// solicitud -- así wompi-webhook sabe a cuál corresponde un pago aprobado.
//
// La firma de integridad se calcula AQUÍ, en el servidor, nunca en el
// navegador: Wompi la usa para comprobar que el monto/referencia no se
// manipularon en el camino. Si viviera en el cliente, cualquiera podría
// generar su propia firma para pagar un monto distinto al real.
//
// Llave pública, secreto de integridad, moneda y monto son secretos de
// Supabase que configura el dueño del proyecto directamente -- nunca se
// comparten en el código ni en el chat con el asistente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { errOut } from "../_shared/errOut.ts";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { solicitudId } = await req.json();
    if (!solicitudId) return jsonOut({ status: "error", message: "solicitudId requerido." });

    const publicKey = Deno.env.get("WOMPI_PUBLIC_KEY") || "";
    const integritySecret = Deno.env.get("WOMPI_INTEGRITY_SECRET") || "";
    const currency = Deno.env.get("WOMPI_CURRENCY") || "";
    const amountInCents = Number(Deno.env.get("WOMPI_AMOUNT_CENTS") || "0");
    const redirectBase = Deno.env.get("WOMPI_REDIRECT_URL") || "https://www.predigoles.com/setup";
    if (!publicKey || !integritySecret || !currency || !amountInCents) {
      return jsonOut({ status: "error", message: "La pasarela de pago todavía no está configurada. Intenta de nuevo más tarde." });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: solicitud, error } = await db
      .from("group_requests")
      .select("id, estado_pago")
      .eq("id", String(solicitudId))
      .maybeSingle();
    if (error) return errOut("crear-pago-wompi", error);
    if (!solicitud) return jsonOut({ status: "error", message: "Solicitud no encontrada." });
    if (solicitud.estado_pago === "pagado") {
      return jsonOut({ status: "error", message: "Esta solicitud ya fue pagada." });
    }

    const reference = String(solicitud.id);
    const signature = await sha256Hex(reference + amountInCents + currency + integritySecret);

    // "pago=1" le dice a renderSetup() que viene de un checkout (sin
    // depender de adivinar el formato de los parámetros propios de Wompi);
    // "ref" le permite, con estado-pago-solicitud, confirmar que ESE pago
    // puntual quedó realmente aprobado antes de decir "gracias por tu
    // compra" -- antes se mostraba ese mensaje solo por haber vuelto del
    // checkout, incluso si el pago fue rechazado o cancelado.
    const redirectUrl = redirectBase + (redirectBase.includes("?") ? "&" : "?") + "pago=1&ref=" + encodeURIComponent(reference);

    const { error: errUpdate } = await db
      .from("group_requests")
      .update({ monto_centavos: amountInCents })
      .eq("id", reference);
    if (errUpdate) return errOut("crear-pago-wompi", errUpdate);

    return jsonOut({
      status: "success",
      checkoutUrl: "https://checkout.wompi.co/p/",
      publicKey,
      currency,
      amountInCents,
      reference,
      signature,
      redirectUrl,
    });
  } catch (err) {
    return errOut("crear-pago-wompi", err);
  }
});
