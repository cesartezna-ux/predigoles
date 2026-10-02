// Envía al admin de un grupo, por correo (SMTP de contacto@predigoles.com
// en GoDaddy), el link, el PIN y las instrucciones básicas de uso. Se llama
// desde el mismo modal donde se muestra el PIN en texto plano por primera
// vez (ver mostrarGrupoCreado() en index.html) -- es la única oportunidad:
// el backend nunca vuelve a tener el PIN en texto plano después de esto,
// solo el hash.
//
// Acción del administrador central (requiere PIN maestro), igual que
// crear/resetear un grupo -- nunca se dispara sola, siempre con un clic
// explícito del admin en Panel Central.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { sanitizeTab } from "../_shared/validate.ts";
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
    const nombre = String(nombreGrupo || "").trim();
    if (!nombre) return jsonOut({ status: "error", message: "Falta el nombre del grupo." });
    const correo = String(correoAdmin || "").trim();
    if (!correo.includes("@")) return jsonOut({ status: "error", message: "Correo del administrador inválido." });
    const pinLimpio = String(pin || "").trim();
    if (!/^\d{4}$/.test(pinLimpio)) return jsonOut({ status: "error", message: "PIN inválido." });
    const admin = String(nombreAdmin || "").trim().slice(0, 60);

    const smtpHost = Deno.env.get("SMTP_HOST") || "";
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
    const smtpUser = Deno.env.get("SMTP_USER") || "";
    const smtpPass = Deno.env.get("SMTP_PASS") || "";
    if (!smtpHost || !smtpUser || !smtpPass) {
      return jsonOut({ status: "error", message: "El envío de correo todavía no está configurado." });
    }

    const link = `https://www.predigoles.com/?grupo=${idLimpio}`;
    const saludo = admin ? `¡Hola, ${admin}!` : "¡Hola!";
    const asunto = `Tu quiniela "${nombre}" ya está lista — Predigoles`;

    // RFC 5322 exige \r\n como fin de línea en el cuerpo del correo -- los
    // template strings de JS solo traen \n. La mayoría de servidores SMTP
    // lo toleran igual, pero el de GoDaddy lo rechaza de plano (552 "bare
    // LF"), así que se normaliza antes de enviar.
    const crlf = (s: string) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

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
      await client.send({
        from: smtpUser,
        to: correo,
        subject: asunto,
        content: texto,
        html,
      });
    } finally {
      await client.close();
    }

    console.log("[notificar-admin-grupo] Correo enviado para grupo", idLimpio);
    return jsonOut({ status: "success" });
  } catch (err) {
    return errOut("notificar-admin-grupo", err);
  }
});
