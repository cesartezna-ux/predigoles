// Traducción directa de checkAdminAuth/checkPlayerAuth en Code.gs.
// Se usan aquí (login) y se reutilizarán en las Edge Functions de
// escrituras protegidas (subtarea 03) -- mismo rol que cumplían en
// doPost para "set" de PROTECTED_KEYS y "preds_<id>".
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitCheck, rateLimitRegistrarFallo, rateLimitRegistrarExito } from "./rateLimit.ts";

type RespuestaError = { status: "error"; message: string };

export async function checkAdminAuth(
  db: SupabaseClient,
  groupId: string,
  pinEnviado: string | null | undefined,
): Promise<RespuestaError | null> {
  const identidad = "admin_" + groupId;
  const bloqueo = await rateLimitCheck(db, identidad);
  if (bloqueo) return bloqueo;

  const { data } = await db
    .from("group_secrets")
    .select("admin_pin_hash")
    .eq("group_id", groupId)
    .maybeSingle();

  const adminPinGuardado = data?.admin_pin_hash;
  if (!adminPinGuardado || !pinEnviado || pinEnviado !== adminPinGuardado) {
    await rateLimitRegistrarFallo(db, identidad);
    return {
      status: "error",
      message: "PIN de administrador inválido, ausente, o el grupo aún no ha sido creado por el administrador central.",
    };
  }
  await rateLimitRegistrarExito(db, identidad);
  return null;
}

// Traducción de checkMasterAuth() en Code.gs. El PIN maestro NUNCA vive
// en una tabla -- solo en el secreto MASTER_PIN_HASH del proyecto de
// Supabase (equivalente a PropertiesService en Apps Script), configurado
// con `supabase secrets set MASTER_PIN_HASH=<hash>`.
export async function checkMasterAuth(
  db: SupabaseClient,
  pinEnviado: string | null | undefined,
): Promise<RespuestaError | null> {
  const identidad = "master";
  const bloqueo = await rateLimitCheck(db, identidad);
  if (bloqueo) return bloqueo;

  const masterPinHash = Deno.env.get("MASTER_PIN_HASH") || "";
  if (!masterPinHash) {
    return { status: "error", message: "PIN maestro no configurado en el servidor todavía." };
  }
  if (!pinEnviado || pinEnviado !== masterPinHash) {
    await rateLimitRegistrarFallo(db, identidad);
    return { status: "error", message: "PIN maestro inválido." };
  }
  await rateLimitRegistrarExito(db, identidad);
  return null;
}

export async function checkPlayerAuth(
  db: SupabaseClient,
  groupId: string,
  playerId: string,
  pinEnviado: string | null | undefined,
): Promise<RespuestaError | null> {
  const identidad = "player_" + groupId + "_" + playerId;
  const bloqueo = await rateLimitCheck(db, identidad);
  if (bloqueo) return bloqueo;

  const { data } = await db
    .from("players")
    .select("pin_hash")
    .eq("group_id", groupId)
    .eq("id", playerId)
    .maybeSingle();

  const storedHash = data?.pin_hash;
  if (!storedHash || !pinEnviado || pinEnviado !== storedHash) {
    await rateLimitRegistrarFallo(db, identidad);
    return {
      status: "error",
      message: "PIN de jugador inválido o el jugador no ha iniciado sesión en este dispositivo.",
    };
  }
  await rateLimitRegistrarExito(db, identidad);
  return null;
}
