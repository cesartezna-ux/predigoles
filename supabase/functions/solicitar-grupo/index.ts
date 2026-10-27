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
import { notificarPagoTransferencia } from "../_shared/notificarPagoTransferencia.ts";

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
    const ciudadAdmin = limpiarTexto(body.ciudadAdmin, 60);
    if (!nombreAdmin) return jsonOut({ status: "error", message: "Falta el nombre del administrador." });
    if (!celularAdmin) return jsonOut({ status: "error", message: "Falta el celular del administrador." });
    if (!correoAdmin.includes("@")) return jsonOut({ status: "error", message: "Correo del administrador inválido." });
    if (!ciudadAdmin) return jsonOut({ status: "error", message: "Falta la ciudad." });

    // Atrapa dominios sin correo configurado (inventados, con typo grave, etc.)
    // antes de guardar la solicitud -- así se evita el caso real de un correo
    // que rebota porque el dominio ni siquiera puede recibir correos. Solo se
    // bloquea cuando el DNS respondió y no hay NINGÚN registro MX; si el
    // lookup mismo falla (timeout, resolver caído, dominio no resuelve en
    // absoluto), se deja pasar -- nunca se bloquea a alguien por una falla
    // transitoria de nuestro lado.
    const dominioCorreo = correoAdmin.split("@")[1] || "";
    if (dominioCorreo) {
      try {
        const mx = await Deno.resolveDns(dominioCorreo, "MX");
        // Un registro "." (exchange) es un Null MX (RFC 7505) -- el dominio
        // declaró explícitamente que no recibe correo. Cuenta igual que no
        // tener ningún registro.
        const recibeCorreo = mx.some((r) => r.exchange !== ".");
        if (!recibeCorreo) {
          return jsonOut({ status: "error", message: "Ese dominio de correo no puede recibir correos. Revisa que esté bien escrito." });
        }
      } catch (errDns) {
        console.error("[solicitar-grupo] No se pudo verificar MX del dominio (se deja pasar):", dominioCorreo, String(errDns));
      }
    }

    let pinDeseado: string | null = limpiarTexto(body.pinDeseado, 4);
    if (pinDeseado && !/^\d{4}$/.test(pinDeseado)) {
      return jsonOut({ status: "error", message: "El PIN debe ser de 4 dígitos, o déjalo vacío." });
    }
    if (!pinDeseado) pinDeseado = null;

    // Wompi es el default por compatibilidad hacia atrás (frontends viejos
    // que no mandan este campo); "transferencia" y "bold" son las otras
    // opciones válidas -- cualquier otro valor se descarta en vez de
    // guardarse.
    const metodoPago = body.metodoPago === "transferencia" ? "transferencia" : body.metodoPago === "bold" ? "bold" : "wompi";

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
      ciudad_admin: ciudadAdmin,
      pin_deseado: pinDeseado,
      metodo_pago: metodoPago,
    }).select("id").single();
    if (error) return errOut("solicitar-grupo", error);

    // Transferencia no tiene webhook que avise solo cuando llega la plata
    // (a diferencia de Wompi) -- el primer paso es que el admin maestro se
    // entere de que hay algo que revisar en el banco. Un fallo de correo
    // aquí no debe tumbar la solicitud ya guardada -- el comprador igual
    // necesita ver la pantalla con el QR y las instrucciones.
    if (metodoPago === "transferencia") {
      try {
        await notificarPagoTransferencia({
          solicitudId: String(data.id),
          grupoId,
          nombreGrupo,
          nombreAdmin,
          correoAdmin,
          celularAdmin,
          torneoId,
        });
      } catch (err) {
        console.error("[solicitar-grupo] No se pudo notificar la solicitud por transferencia:", err);
      }
    }

    // El frontend necesita este id para pedir el link de pago (crear-pago-wompi)
    // usándolo como referencia -- así el webhook sabe a qué solicitud corresponde
    // un pago confirmado. Para transferencia, el mismo id identifica la solicitud
    // que se muestra en Panel Central y se usa como concepto sugerido.
    return jsonOut({ status: "success", solicitudId: data.id });
  } catch (err) {
    return errOut("solicitar-grupo", err);
  }
});
