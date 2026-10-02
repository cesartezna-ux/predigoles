// Recibe el formulario público /setup (después de comprar en Gumroad) y
// guarda una solicitud para que el administrador central la revise y cree
// el grupo desde Panel Central. Endpoint público (sin PIN) -- por eso
// valida cada campo a fondo y limita cuántas veces se puede llamar
// seguido, en vez de confiar en que solo lo use el formulario real.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { sanitizeTab } from "../_shared/validate.ts";
import { rateLimitCheck, rateLimitRegistrarFallo } from "../_shared/rateLimit.ts";
import { TORNEOS_SYNC } from "../_shared/torneosSync.ts";
import { errOut } from "../_shared/errOut.ts";

function limpiarTexto(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Sin autenticación (es un formulario público) -- el límite es por IP,
    // no por identidad de grupo/organizador como el resto del sistema.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "sin-ip";
    const identidad = "solicitar-grupo_" + ip;
    const bloqueo = await rateLimitCheck(db, identidad);
    if (bloqueo) return jsonOut(bloqueo);
    await rateLimitRegistrarFallo(db, identidad); // cuenta cada intento, no solo los fallidos -- el límite es "cuántas veces", no "cuántos errores"

    const body = await req.json();

    const grupoId = sanitizeTab(body.grupoId);
    if (!grupoId) return jsonOut({ status: "error", message: "ID de grupo inválido (solo letras, números y guiones)." });

    const nombreGrupo = limpiarTexto(body.nombreGrupo, 60);
    if (!nombreGrupo) return jsonOut({ status: "error", message: "Falta el nombre del grupo." });

    const torneoId = limpiarTexto(body.torneoId, 40);
    if (!Object.prototype.hasOwnProperty.call(TORNEOS_SYNC, torneoId)) {
      return jsonOut({ status: "error", message: "Torneo inválido." });
    }

    const modoSeguimiento = body.modoSeguimiento === "equipo" ? "equipo" : "torneo";
    let equiposSeguidos: string[] = [];
    if (modoSeguimiento === "equipo") {
      const arr = Array.isArray(body.equiposSeguidos) ? body.equiposSeguidos : [];
      equiposSeguidos = arr.slice(0, 40).map((e: unknown) => limpiarTexto(e, 60)).filter(Boolean);
      if (!equiposSeguidos.length) {
        return jsonOut({ status: "error", message: "Elige al menos un equipo, o marca \"todo el torneo\"." });
      }
    }

    const nombreAdmin = limpiarTexto(body.nombreAdmin, 60);
    const celularAdmin = limpiarTexto(body.celularAdmin, 20);
    const correoAdmin = limpiarTexto(body.correoAdmin, 60);
    if (!nombreAdmin) return jsonOut({ status: "error", message: "Falta el nombre del administrador." });
    if (!celularAdmin) return jsonOut({ status: "error", message: "Falta el celular del administrador." });
    if (!correoAdmin.includes("@")) return jsonOut({ status: "error", message: "Correo del administrador inválido." });

    let pinDeseado: string | null = limpiarTexto(body.pinDeseado, 4);
    if (pinDeseado && !/^\d{4}$/.test(pinDeseado)) {
      return jsonOut({ status: "error", message: "El PIN debe ser de 4 dígitos, o déjalo vacío." });
    }
    if (!pinDeseado) pinDeseado = null;

    // Evita que el comprador reciba "solicitud enviada ✓" con un ID que en
    // realidad ya está tomado -- sin esto, el choque solo se descubre
    // cuando el admin central intenta crear el grupo desde Panel Central
    // y admin-provisionar-grupo lo rechaza por duplicado.
    const { data: yaExiste } = await db.from("groups").select("id").eq("id", grupoId).maybeSingle();
    if (yaExiste) return jsonOut({ status: "error", message: "Ese ID de grupo ya existe. Elige otro." });
    const { data: yaSolicitado } = await db.from("group_requests").select("id").eq("grupo_id", grupoId).eq("estado", "pendiente").maybeSingle();
    if (yaSolicitado) return jsonOut({ status: "error", message: "Ya hay una solicitud pendiente con ese ID de grupo. Elige otro, o espera a que se active." });

    const { data, error } = await db.from("group_requests").insert({
      grupo_id: grupoId,
      nombre_grupo: nombreGrupo,
      torneo_id: torneoId,
      modo_seguimiento: modoSeguimiento,
      equipos_seguidos: equiposSeguidos,
      nombre_admin: nombreAdmin,
      celular_admin: celularAdmin,
      correo_admin: correoAdmin,
      pin_deseado: pinDeseado,
    }).select("id").single();
    if (error) return errOut("solicitar-grupo", error);

    // El frontend necesita este id para pedir el link de pago (crear-pago-wompi)
    // usándolo como referencia -- así el webhook sabe a qué solicitud corresponde
    // un pago confirmado.
    return jsonOut({ status: "success", solicitudId: data.id });
  } catch (err) {
    return errOut("solicitar-grupo", err);
  }
});
