-- ============================================================
-- Predigoles — programar sincronizar-resultados cada 10 minutos
-- Reemplaza el disparador por tiempo de Apps Script (⏰ Activadores).
--
-- ⚠️ ANTES de correr este archivo, guarda la llave de servicio en
-- Vault -- NUNCA la pegues en este archivo ni la commitees a git.
-- Corre esto una sola vez en el SQL Editor de Supabase (con el valor
-- real, no lo que está aquí) y no lo dejes en ningún historial:
--
--   select vault.create_secret('TU_SERVICE_ROLE_KEY_REAL', 'service_role_key');
--
-- Cómo aplicar el resto de este archivo: pégalo en el SQL Editor y
-- ejecútalo -- ya sin el paso de arriba, que es aparte.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sincronizar-resultados-cron',
  '*/10 * * * *', -- cada 10 minutos; ajustable con cron.alter_job() más adelante
  $$
  select net.http_post(
    url := 'https://advdcsdcknschwgfilme.supabase.co/functions/v1/sincronizar-resultados',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
