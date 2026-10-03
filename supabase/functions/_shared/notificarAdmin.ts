// Lógica real de "enviar el correo de bienvenida" (antes solo vivía dentro
// de notificar-admin-grupo) -- se saca a un módulo aparte para que
// wompi-webhook pueda mandarlo automáticamente justo después de crear el
// grupo, mientras el PIN en texto plano todavía existe en memoria (nunca se
// vuelve a tener después de este momento -- solo queda el hash).
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

export type NotificarAdminInput = {
  grupoId: string;
  nombreGrupo: unknown;
  nombreAdmin: unknown;
  correoAdmin: unknown;
  pin: unknown;
};

export type NotificarAdminResultado = { status: "success" } | { status: "error"; message: string };

// RFC 5322 exige \r\n como fin de línea en el cuerpo del correo -- los
// template strings de JS solo traen \n. La mayoría de servidores SMTP lo
// toleran igual, pero el de GoDaddy lo rechaza de plano (552 "bare LF").
function crlf(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

export async function notificarAdminPorCorreo(input: NotificarAdminInput): Promise<NotificarAdminResultado> {
  const correo = String(input.correoAdmin || "").trim();
  if (!correo.includes("@")) return { status: "error", message: "Correo del administrador inválido." };
  const pinLimpio = String(input.pin || "").trim();
  if (!/^\d{4}$/.test(pinLimpio)) return { status: "error", message: "PIN inválido." };
  const nombre = String(input.nombreGrupo || "").trim();
  const admin = String(input.nombreAdmin || "").trim().slice(0, 60);

  const smtpHost = Deno.env.get("SMTP_HOST") || "";
  const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
  const smtpUser = Deno.env.get("SMTP_USER") || "";
  const smtpPass = Deno.env.get("SMTP_PASS") || "";
  if (!smtpHost || !smtpUser || !smtpPass) {
    return { status: "error", message: "El envío de correo todavía no está configurado." };
  }

  const link = `https://www.predigoles.com/?grupo=${input.grupoId}`;
  const saludo = admin ? `¡Hola, ${admin}!` : "¡Hola!";
  const asunto = `Tu quiniela "${nombre}" ya está lista — Predigoles`;

  const texto = crlf(`${saludo}

Tu quiniela "${nombre}" ya está lista en Predigoles.

Link de tu grupo: ${link}
Tu PIN de administrador: ${pinLimpio}

Para entrar como organizador: abre el link, toca el botón "Organizador" (abajo de la pantalla) e ingresa tu PIN. Ahí mismo, en el menú, encuentras "Cómo usar Predigoles" con la guía completa (invitar jugadores, reglas del juego, premios, y más).

Guarda este correo -- es la única vez que se envía el PIN en texto plano.`);

  const html = crlf(`<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#222">
      <h2 style="margin:0 0 12px">${saludo}</h2>
      <p>Tu quiniela <b>${nombre}</b> ya está lista en Predigoles.</p>
      <p><b>Link de tu grupo:</b><br><a href="${link}">${link}</a></p>
      <p><b>Tu PIN de administrador:</b><br><span style="font-size:22px;letter-spacing:4px;font-weight:bold">${pinLimpio}</span></p>
      <p>Para entrar como organizador: abre el link, toca el botón <b>"Organizador"</b> (abajo de la pantalla) e ingresa tu PIN. Ahí mismo, en el menú, encuentras <b>"Cómo usar Predigoles"</b> con la guía completa (invitar jugadores, reglas del juego, premios, y más).</p>
      <p style="color:#888;font-size:12px">Guarda este correo — es la única vez que se envía el PIN en texto plano.</p>
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
    await client.send({ from: smtpUser, to: correo, subject: asunto, content: texto, html });
  } finally {
    await client.close();
  }

  return { status: "success" };
}
