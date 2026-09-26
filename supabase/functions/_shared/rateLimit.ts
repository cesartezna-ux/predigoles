// Rate limiting / fuerza bruta -- traducción directa de la versión en
// Code.gs (rateLimitCheck/rateLimitRegistrarFallo/rateLimitRegistrarExito).
// Ahí usaba CacheService (memoria compartida de Apps Script, con
// expiración automática); aquí no existe ese servicio, así que se
// respalda en la tabla rate_limits -- misma lógica, mismos umbrales.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_INTENTOS = 6;
const VENTANA_MS = 10 * 60 * 1000; // 10 min: ventana en la que se cuentan los fallos
const BLOQUEO_MS = 10 * 60 * 1000; // 10 min: tiempo de bloqueo tras superar el límite

type RespuestaBloqueo = { status: "error"; message: string };

export async function rateLimitCheck(
  db: SupabaseClient,
  identidad: string,
): Promise<RespuestaBloqueo | null> {
  const { data } = await db
    .from("rate_limits")
    .select("bloqueado_hasta")
    .eq("identidad", identidad)
    .maybeSingle();

  if (data?.bloqueado_hasta && new Date(data.bloqueado_hasta) > new Date()) {
    return {
      status: "error",
      message: "Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.",
    };
  }
  return null;
}

export async function rateLimitRegistrarFallo(db: SupabaseClient, identidad: string): Promise<void> {
  const ahora = new Date();
  const { data } = await db
    .from("rate_limits")
    .select("intentos, ventana_hasta")
    .eq("identidad", identidad)
    .maybeSingle();

  // Si la ventana anterior ya venció (o no existe todavía), se reinicia el conteo.
  const ventanaVigente = data?.ventana_hasta && new Date(data.ventana_hasta) > ahora;
  const intentos = ventanaVigente ? (data!.intentos ?? 0) + 1 : 1;

  if (intentos >= MAX_INTENTOS) {
    await db.from("rate_limits").upsert({
      identidad,
      intentos: 0,
      ventana_hasta: null,
      bloqueado_hasta: new Date(ahora.getTime() + BLOQUEO_MS).toISOString(),
    });
  } else {
    await db.from("rate_limits").upsert({
      identidad,
      intentos,
      ventana_hasta: new Date(ahora.getTime() + VENTANA_MS).toISOString(),
      bloqueado_hasta: null,
    });
  }
}

export async function rateLimitRegistrarExito(db: SupabaseClient, identidad: string): Promise<void> {
  await db.from("rate_limits").delete().eq("identidad", identidad);
}
