// Un error de Postgres (o cualquier excepción no prevista) nunca debe
// llegar tal cual al cliente -- puede filtrar nombres de tabla/columna o
// detalles de un constraint interno. Se registra en los logs de la Edge
// Function (visibles en el dashboard de Supabase, buscable por "context")
// para poder diagnosticar sin adivinar, y al cliente se le responde un
// mensaje genérico y seguro.
import { jsonOut } from "./cors.ts";

export function errOut(context: string, err: unknown): Response {
  console.error(`[${context}]`, err);
  return jsonOut({ status: "error", message: "No se pudo completar la operación. Intenta de nuevo en unos segundos." });
}
