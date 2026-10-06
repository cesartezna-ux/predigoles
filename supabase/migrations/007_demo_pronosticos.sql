-- ============================================================
-- Predigoles — demo público de pronósticos en la landing (Home).
-- Pronósticos sin PIN sobre un partido ya iniciado (solo demo: en la app
-- real cierran 1 minuto antes del inicio). Es un embudo de conversión,
-- no pertenece a ningún grupo.
-- Reglas: un apodo por partido (sin distinguir mayúsculas) y una entrada
-- por navegador y partido. Los apodos son datos personales: se borran 30
-- días después de que termine el partido (job pendiente, se agrega con las
-- funciones del demo).
-- ============================================================

create table demo_pronosticos (
  id uuid primary key default gen_random_uuid(),
  torneo_id text not null,
  match_id text not null,
  apodo text not null check (char_length(apodo) between 2 and 20),
  emoji text not null,
  home_score int not null check (home_score between 0 and 9),
  away_score int not null check (away_score between 0 and 9),
  navegador_id text not null,
  created_at timestamptz not null default now()
);

create unique index demo_apodo_por_partido on demo_pronosticos (match_id, lower(apodo));
create unique index demo_navegador_por_partido on demo_pronosticos (match_id, navegador_id);

-- Sin políticas de RLS: nadie lee ni escribe directo. Solo las Edge Functions
-- del demo, con la llave de servicio, leen y escriben.
alter table demo_pronosticos enable row level security;
