// Permite al admin maestro elegir desde Panel Central qué partido se
// fuerza como destacado en el demo público de Home (ver partidoDemo() en
// _shared/demo.ts), en vez de editar a mano el arreglo DESTACADOS que
// antes vivía hardcodeado en el código y exigía un redeploy por cada
// partido puntual.
//
// Solo puede haber un destacado "activo" a la vez: guardar uno nuevo
// expira el anterior (hasta=now()) en vez de borrarlo, para dejar
// historial sin necesidad de una tabla de auditoría aparte.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonOut } from "../_shared/cors.ts";
import { checkMasterAuth } from "../_shared/auth.ts";
import { errOut } from "../_shared/errOut.ts";

type Destacado = {
  id: string;
  torneoId: string;
  matchId: string;
  home: string;
  away: string;
  desde: string;
  hasta: string;
};

function aRespuesta(row: Record<string, unknown> | null): Destacado | null {
  if (!row) return null;
  return {
    id: String(row.id),
    torneoId: String(row.torneo_id),
    matchId: String(row.match_id),
    home: String(row.home),
    away: String(row.away),
    desde: String(row.desde),
    hasta: String(row.hasta),
  };
}

function textoValido(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const limpio = v.trim();
  return limpio.length > 0 && limpio.length <= max ? limpio : null;
}

Deno.serve(async (req: Request) => {
  const optionsResp = handleOptions(req);
  if (optionsResp) return optionsResp;

  try {
    const body = await req.json();
    const { masterPin, accion } = body;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authErr = await checkMasterAuth(db, masterPin ? String(masterPin) : null);
    if (authErr) return jsonOut(authErr);

    const nowIso = new Date().toISOString();

    if (accion === "guardar") {
      const torneoId = textoValido(body.torneoId, 60);
      const matchId = textoValido(body.matchId, 60);
      const home = textoValido(body.home, 80);
      const away = textoValido(body.away, 80);
      const hasta = typeof body.hasta === "string" ? body.hasta : "";
      const hastaMs = Date.parse(hasta);
      if (!torneoId || !matchId || !home || !away) {
        return jsonOut({ status: "error", message: "Faltan datos del partido." });
      }
      if (!hasta || Number.isNaN(hastaMs) || hastaMs <= Date.now()) {
        return jsonOut({ status: "error", message: "La vigencia debe ser una fecha futura." });
      }

      const { error: errExpirar } = await db
        .from("demo_destacados")
        .update({ hasta: nowIso })
        .gt("hasta", nowIso);
      if (errExpirar) return errOut("admin-destacado-demo", errExpirar);

      const { data, error } = await db
        .from("demo_destacados")
        .insert({ torneo_id: torneoId, match_id: matchId, home, away, hasta })
        .select("id, torneo_id, match_id, home, away, desde, hasta")
        .single();
      if (error) return errOut("admin-destacado-demo", error);

      console.log("[admin-destacado-demo] Nuevo destacado guardado:", { torneoId, matchId, home, away, hasta });
      return jsonOut({ status: "success", destacado: aRespuesta(data) });
    }

    if (accion === "quitar") {
      const { error } = await db
        .from("demo_destacados")
        .update({ hasta: nowIso })
        .gt("hasta", nowIso);
      if (error) return errOut("admin-destacado-demo", error);

      console.log("[admin-destacado-demo] Destacado activo retirado manualmente.");
      return jsonOut({ status: "success", destacado: null });
    }

    // Sin acción: solo consulta cuál está activo ahora mismo.
    const { data, error } = await db
      .from("demo_destacados")
      .select("id, torneo_id, match_id, home, away, desde, hasta")
      .lte("desde", nowIso)
      .gt("hasta", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return errOut("admin-destacado-demo", error);

    return jsonOut({ status: "success", destacado: aRespuesta(data) });
  } catch (err) {
    return errOut("admin-destacado-demo", err);
  }
});
