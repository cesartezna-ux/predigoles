// Predigoles corre en GitHub Pages (predigoles.com), así que toda llamada
// a estas Edge Functions es cross-origin -- sin estos headers, el navegador
// bloquea la respuesta antes de que el frontend la vea.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Cada función debe llamar esto primero y devolver la respuesta si no es null.
export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export function jsonOut(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
