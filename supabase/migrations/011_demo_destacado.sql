-- ============================================================
-- Predigoles — partido destacado del demo de Home, elegido a mano desde
-- Panel Central (admin maestro) en vez de editar a mano el arreglo
-- DESTACADOS que vivía hardcodeado en supabase/functions/_shared/demo.ts
-- (obligaba a editar código + redeploy por cada partido puntual, ej.
-- Croacia-España del 6/10/2026). partidoDemo()/siguientePrueba() leen
-- esta tabla para dar el mismo boost de prioridad que antes daba ese
-- arreglo; puede haber varias filas (historial), pero solo cuenta la más
-- reciente cuyo rango [desde, hasta) incluye "ahora".
-- ============================================================

create table demo_destacados (
  id uuid primary key default gen_random_uuid(),
  torneo_id text not null,
  match_id text not null,
  home text not null,
  away text not null,
  desde timestamptz not null default now(),
  hasta timestamptz not null,
  created_at timestamptz not null default now()
);

create index demo_destacados_vigencia on demo_destacados (desde, hasta);

-- Sin políticas de RLS: nadie lee ni escribe directo. Solo la Edge Function
-- admin-destacado-demo, con PIN maestro y la llave de servicio.
alter table demo_destacados enable row level security;
