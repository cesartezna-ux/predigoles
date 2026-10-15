// Avisa al correo central (contacto@predigoles.com) que hay una solicitud
// nueva esperando pago por transferencia (Bre-B) -- a diferencia de Wompi,
// nadie nos avisa solo cuando esa plata llega, así que el primer paso es
// que el admin maestro se entere de que hay algo que revisar en el banco.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { asciiSeguro } from "./asciiSeguro.ts";

export type NotificarTransferenciaInput = {
  solicitudId: string;
  grupoId: string;
  nombreGrupo: unknown;
  nombreAdmin: unknown;
  correoAdmin: unknown;
  celularAdmin: unknown;
  torneoId: unknown;
};

export type NotificarTransferenciaResultado = { status: "success" } | { status: "error"; message: string };

// Mismo motivo que en notificarAdmin.ts: el SMTP de GoDaddy rechaza \n sueltos.
function crlf(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

export async function notificarPagoTransferencia(input: NotificarTransferenciaInput): Promise<NotificarTransferenciaResultado> {
  const smtpHost = Deno.env.get("SMTP_HOST") || "";
  const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
  const smtpUser = Deno.env.get("SMTP_USER") || "";
  const smtpPass = Deno.env.get("SMTP_PASS") || "";
  if (!smtpHost || !smtpUser || !smtpPass) {
    return { status: "error", message: "El envío de correo todavía no está configurado." };
  }

  const nombreGrupo = String(input.nombreGrupo || "").trim();
  const nombreAdmin = String(input.nombreAdmin || "").trim();
  const correoAdmin = String(input.correoAdmin || "").trim();
  const celularAdmin = String(input.celularAdmin || "").trim();
  const torneoId = String(input.torneoId || "").trim();

  // asciiSeguro(): el nombre del grupo lo escribe el comprador y puede
  // traer tildes/eñe -- el asunto se manda sin codificar (ver ese archivo).
  const asunto = asciiSeguro(`Nueva solicitud por transferencia - "${nombreGrupo}" (${input.grupoId})`);

  const texto = crlf(`Hay una solicitud nueva esperando pago por transferencia (Bre-B).

Grupo: ${nombreGrupo} (${input.grupoId})
Torneo: ${torneoId}
Admin: ${nombreAdmin} · ${celularAdmin} · ${correoAdmin}

El comprador debería haber puesto "${input.grupoId}" como concepto de la transferencia -- revisa tu app del banco contra ese código, y cuando confirmes el pago, márcalo en Panel Central (pestaña Solicitudes) y crea el grupo desde ahí.`);

  const html = crlf(`<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#222">
      <h2 style="margin:0 0 12px">Nueva solicitud por transferencia</h2>
      <p><b>Grupo:</b> ${nombreGrupo} (<code>${input.grupoId}</code>)</p>
      <p><b>Torneo:</b> ${torneoId}</p>
      <p><b>Admin:</b> ${nombreAdmin} · ${celularAdmin} · ${correoAdmin}</p>
      <p>El comprador debería haber puesto <code>${input.grupoId}</code> como concepto de la transferencia — revisa tu app del banco contra ese código.</p>
      <p>Cuando confirmes el pago, márcalo en <b>Panel Central, pestaña Solicitudes</b>, y crea el grupo desde ahí.</p>
    </div>`);

  const client = new SMTPClient({
    connection: {
      hostname: smtpHost,
      port: smtpPort,
      tls: smtpPort === 465,
      auth: { username: smtpUser, password: smtpPass },
    },
  });

  try {
    await client.send({ from: smtpUser, to: "contacto@predigoles.com", subject: asunto, content: texto, html });
  } finally {
    await client.close();
  }

  return { status: "success" };
}
