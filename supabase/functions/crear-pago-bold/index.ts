// Crea un link de pago de Bold (API Link de pagos) para una solicitud ya
// guardada por solicitar-grupo -- mismo rol que crear-pago-wompi, pero a
// diferencia de Wompi (que exige firmar el checkout en el cliente), Bold
// ya devuelve una URL de checkout lista para usar: no hay firma que
// propagar al navegador.
//
// La referencia del pago ES el id de la solicitud -- así bold-webhook sabe
// a cuál corresponde un pago aprobado, igual que con Wompi.
//
// Llave de identidad y monto son secretos de Supabase que configura el
// dueño del proyecto directamente -- nunca se comparten en el código ni en
// el chat con el asistente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { errOut } from "../_shared/errOut.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const { solicitudId } = await req.json();
    if (!solicitudId) return jsonOut({ status: "error", message: "solicitudId requerido." });

    const apiKey = Deno.env.get("BOLD_API_KEY") || "";
    const amountCop = Number(Deno.env.get("BOLD_AMOUNT_COP") || "0");
    const redirectBase = Deno.env.get("BOLD_REDIRECT_URL") || "https://www.predigoles.com/setup";
    if (!apiKey || !amountCop) {
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
    if (error) return errOut("crear-pago-bold", error);
    if (!solicitud) return jsonOut({ status: "error", message: "Solicitud no encontrada." });
    if (solicitud.estado_pago === "pagado") {
      return jsonOut({ status: "error", message: "Esta solicitud ya fue pagada." });
    }

    const reference = String(solicitud.id);
    // "pago=1" le dice a renderSetup() que viene de un checkout; "ref" le
    // permite, con estado-pago-solicitud, confirmar que ESE pago puntual
    // quedó realmente aprobado antes de decir "gracias por tu compra" --
    // mismo contrato que ya usa crear-pago-wompi, reutilizado tal cual.
    const callbackUrl = redirectBase + (redirectBase.includes("?") ? "&" : "?") + "pago=1&ref=" + encodeURIComponent(reference);

    const boldResp = await fetch("https://integrations.api.bold.co/online/link/v1", {
      method: "POST",
      headers: {
        "Authorization": `x-api-key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount_type: "CLOSE",
        amount: { currency: "COP", total_amount: amountCop },
        reference,
        description: "Quiniela Predigoles",
        callback_url: callbackUrl,
        payment_methods: ["CREDIT_CARD"],
      }),
    });
    const boldData = await boldResp.json();
    if (!boldResp.ok || !boldData?.payload?.url) {
      console.error("[crear-pago-bold] Bold rechazó la creación del link.", { status: boldResp.status, body: boldData });
      return jsonOut({ status: "error", message: "No se pudo generar el link de pago. Intenta de nuevo." });
    }

    const { error: errUpdate } = await db
      .from("group_requests")
      .update({ monto_centavos: amountCop * 100 })
      .eq("id", reference);
    if (errUpdate) return errOut("crear-pago-bold", errUpdate);

    return jsonOut({ status: "success", checkoutUrl: boldData.payload.url });
  } catch (err) {
    return errOut("crear-pago-bold", err);
  }
});
