-- ============================================================
-- Predigoles — tabla de rate limiting para Supabase
-- Reemplaza CacheService de Apps Script, que no existe aquí.
-- Aplicar en el SQL Editor de Supabase, una sola vez, DESPUÉS de
-- haber corrido supabase/schema.sql.
-- ============================================================

create table rate_limits (
  identidad text primary key,
  intentos int not null default 0,
  ventana_hasta timestamptz,   -- hasta cuándo cuentan los fallos acumulados
  bloqueado_hasta timestamptz  -- si está en el futuro, la identidad está bloqueada
);

-- Solo las Edge Functions (con la llave de servicio) tocan esta tabla --
-- nunca la lee ni la escribe el cliente directamente, así que no necesita
-- ninguna política para anon/authenticated (RLS niega todo por defecto).
alter table rate_limits enable row level security;
