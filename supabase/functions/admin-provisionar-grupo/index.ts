// Equivalente de action==="adminProvisionarGrupo" en Code.gs. Sigue sin
// existir "primer set libre": todo grupo nace por esta función, nunca
// por autoconfiguración espontánea de quien abra el link primero.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { sanitizeTab } from "../_shared/validate.ts";
import { hashPin } from "../_shared/hashPin.ts";

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const {
      masterPin, grupoId, nombreGrupo, torneoId, modoSeguimiento, equiposSeguidos,
      nombreAdmin, celularAdmin, correoAdmin, pin, estadoPago,
    } = await req.json();

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const idLimpio = sanitizeTab(grupoId);
    if (!idLimpio) return jsonOut({ status: "error", message: "ID de grupo inválido (solo letras, números y guiones)." });

    const nombre = String(nombreGrupo || "").trim();
    if (!nombre) return jsonOut({ status: "error", message: "Falta el nombre del grupo." });
    const torneo = String(torneoId || "").trim();
    if (!torneo) return jsonOut({ status: "error", message: "Falta el torneo." });

    const { data: yaConfigurado } = await db
      .from("group_secrets")
      .select("group_id")
      .eq("group_id", idLimpio)
      .maybeSingle();
    if (yaConfigurado) {
      return jsonOut({
        status: "error",
        message: "Ese grupo ya existe y ya está configurado -- no se puede volver a provisionar (evita borrar datos activos).",
      });
    }

    let pinFinal = String(pin || "").trim();
    if (!pinFinal) pinFinal = String(Math.floor(1000 + Math.random() * 9000)); // genera uno de 4 dígitos si no se especificó
    if (!/^\d{4}$/.test(pinFinal)) return jsonOut({ status: "error", message: "El PIN debe ser de 4 dígitos." });

    const modo = modoSeguimiento === "equipo" ? "equipo" : "torneo";
    const equipos = Array.isArray(equiposSeguidos) ? equiposSeguidos : [];

    const { error: errGrupo } = await db.from("groups").upsert({
      id: idLimpio,
      name: nombre,
      torneo_id: torneo,
      modo_seguimiento: modo,
      equipos_seguidos: equipos,
      admin_nombre: nombreAdmin || null,
      admin_celular: celularAdmin || null,
      admin_correo: correoAdmin || null,
      estado_pago: estadoPago || "Pendiente",
    });
    if (errGrupo) return jsonOut({ status: "error", message: String(errGrupo.message) });

    const { error: errSecret } = await db.from("group_secrets").upsert({
      group_id: idLimpio,
      admin_pin_hash: hashPin(pinFinal),
    });
    if (errSecret) return jsonOut({ status: "error", message: String(errSecret.message) });

    return jsonOut({ status: "success", grupoId: idLimpio, pin: pinFinal });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
});
