// Lógica real de "crear un grupo" (antes solo vivía dentro de
// admin-provisionar-grupo) -- se saca a un módulo aparte para que
// wompi-webhook pueda crear el grupo automáticamente en cuanto confirma un
// pago, sin duplicar esta lógica ni pasar por un segundo viaje HTTP con PIN
// maestro (el propio webhook, ya verificada la firma de Wompi, ES la
// autoridad en ese momento).
//
// Errores de validación (dato faltante, grupo ya provisionado, etc.) se
// devuelven como {status:"error"} -- son esperables y cada llamador decide
// qué hacer. Errores de base de datos de verdad SE LANZAN (throw), para que
// cada llamador los registre con su propio contexto vía errOut().
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeTab } from "./validate.ts";
import { hashPin } from "./hashPin.ts";

export type ProvisionarGrupoInput = {
  grupoId: unknown;
  nombreGrupo: unknown;
  torneoId: unknown;
  modoSeguimiento: unknown;
  equiposSeguidos: unknown;
  nombreAdmin: unknown;
  celularAdmin: unknown;
  correoAdmin: unknown;
  pin: unknown;
  estadoPago: unknown;
};

export type ProvisionarGrupoResultado =
  | { status: "success"; grupoId: string; pin: string }
  | { status: "error"; message: string };

export async function provisionarGrupo(
  db: SupabaseClient,
  input: ProvisionarGrupoInput,
): Promise<ProvisionarGrupoResultado> {
  const idLimpio = sanitizeTab(input.grupoId);
  if (!idLimpio) return { status: "error", message: "ID de grupo inválido (solo letras, números y guiones)." };

  const nombre = String(input.nombreGrupo || "").trim();
  if (!nombre) return { status: "error", message: "Falta el nombre del grupo." };
  const torneo = String(input.torneoId || "").trim();
  if (!torneo) return { status: "error", message: "Falta el torneo." };

  const { data: yaConfigurado } = await db
    .from("group_secrets")
    .select("group_id")
    .eq("group_id", idLimpio)
    .maybeSingle();
  if (yaConfigurado) {
    return {
      status: "error",
      message: "Ese grupo ya existe y ya está configurado -- no se puede volver a provisionar (evita borrar datos activos).",
    };
  }

  let pinFinal = String(input.pin || "").trim();
  if (!pinFinal) pinFinal = String(Math.floor(1000 + Math.random() * 9000)); // genera uno de 4 dígitos si no se especificó
  if (!/^\d{4}$/.test(pinFinal)) return { status: "error", message: "El PIN debe ser de 4 dígitos." };

  const modo = input.modoSeguimiento === "equipo" ? "equipo" : "torneo";
  const equipos = Array.isArray(input.equiposSeguidos) ? input.equiposSeguidos : [];

  const { error: errGrupo } = await db.from("groups").upsert({
    id: idLimpio,
    name: nombre,
    torneo_id: torneo,
    modo_seguimiento: modo,
    equipos_seguidos: equipos,
    admin_nombre: input.nombreAdmin || null,
    admin_celular: input.celularAdmin || null,
    admin_correo: input.correoAdmin || null,
    estado_pago: input.estadoPago || "Pendiente",
  });
  if (errGrupo) throw errGrupo;

  const { error: errSecret } = await db.from("group_secrets").upsert({
    group_id: idLimpio,
    admin_pin_hash: hashPin(pinFinal),
  });
  if (errSecret) throw errSecret;

  return { status: "success", grupoId: idLimpio, pin: pinFinal };
}
