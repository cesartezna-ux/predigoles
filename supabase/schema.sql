-- ============================================================
-- Predigoles — esquema inicial en Supabase (Postgres)
-- Migración desde el modelo KV en Google Sheets (Code.gs).
-- Proyecto Supabase: advdcsdcknschwgfilme
--
-- Cómo aplicarlo: pega este archivo completo en el editor SQL de
-- Supabase (Dashboard → SQL Editor → New query) y ejecútalo una vez.
-- Es seguro de re-ejecutar solo si las tablas no existen todavía --
-- si necesitas volver a correrlo tras un cambio, bórralas primero
-- o usa una migración incremental (no repitas este archivo tal cual
-- sobre un esquema que ya tiene datos).
-- ============================================================

-- ---------- Grupos (antes: una pestaña por grupo en Sheets) ----------
create table groups (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,40}$'),
  name text not null,
  torneo_id text not null,
  modo_seguimiento text not null default 'torneo' check (modo_seguimiento in ('torneo','equipo')),
  equipos_seguidos text[] not null default '{}',
  betting jsonb not null default '{"inscripcion":0,"premios":{"p1":0,"p2":0,"p3":0}}',
  team_overrides jsonb not null default '{}',
  admin_nombre text,
  admin_celular text,
  admin_correo text,
  estado_pago text not null default 'Pendiente',
  created_at timestamptz not null default now()
);

-- PIN del organizador, en tabla aparte a propósito: ninguna política de
-- RLS le da acceso de lectura a "anon" -- solo las Edge Functions (con
-- la llave de servicio) pueden compararlo. Así el hash no puede salir
-- ni por un error futuro de configuración de RLS.
create table group_secrets (
  group_id text primary key references groups(id) on delete cascade,
  admin_pin_hash text not null
);

-- ---------- Jugadores ----------
create table players (
  group_id text not null references groups(id) on delete cascade,
  id text not null,
  name text not null,
  ico text,
  pin_hash text,  -- null hasta el primer login (autoregistro, igual que hoy)
  created_at timestamptz not null default now(),
  primary key (group_id, id)
);

-- Postgres no permite expresiones (lower(name)) dentro de un UNIQUE
-- declarado en CREATE TABLE -- solo columnas simples. La unicidad
-- insensible a mayúsculas va aparte, como índice único.
-- Reemplaza mergeDuplicatePlayers(): el duplicado ya no puede ocurrir.
create unique index players_group_lower_name_key on players (group_id, lower(name));

-- ---------- Pronósticos ----------
create table predictions (
  group_id text not null,
  player_id text not null,
  match_id text not null,  -- referencia a fixtures.match_id o custom_matches.id
  home_score int,
  away_score int,
  updated_at timestamptz not null default now(),
  primary key (group_id, player_id, match_id),
  foreign key (group_id, player_id) references players(group_id, id) on delete cascade
);

-- ---------- Partidos manuales agregados por el organizador ----------
create table custom_matches (
  id text primary key,
  group_id text not null references groups(id) on delete cascade,
  fase text,
  kickoff timestamptz,
  home text not null,
  away text not null,
  venue text,
  home_score int,
  away_score int
);

-- ---------- Calendario oficial por torneo (COMPARTIDO, no por grupo) ----------
-- Antes cada grupo tenía su propia copia de "partidos" en su pestaña,
-- aunque el calendario oficial es idéntico para todos los grupos de un
-- mismo torneo -- pura duplicación, artefacto del modelo por pestañas.
create table fixtures (
  torneo_id text not null,
  match_id text not null,  -- af_<id de api-football>
  fase text,
  kickoff timestamptz,
  home text not null,
  away text not null,
  venue text,
  primary key (torneo_id, match_id)
);

-- ---------- Resultados oficiales por torneo (COMPARTIDOS, no por grupo) ----------
-- Mismo razonamiento que fixtures: hoy _sincronizar() escribe el mismo
-- resultado en la pestaña de cada grupo que sigue ese torneo. Aquí existe
-- una sola vez -- se acaba el riesgo de que un grupo quede desincronizado
-- de otro por una escritura parcial.
create table fixture_results (
  torneo_id text not null,
  match_id text not null,
  home_score int,
  away_score int,
  status text,   -- null = terminado; código de api-football (ej. '1H','HT') si está en vivo
  minute int,
  synced_at timestamptz not null default now(),
  primary key (torneo_id, match_id)
);

-- ---------- Escudos por torneo ----------
create table team_crests (
  torneo_id text not null,
  team_name text not null,
  crest_url text not null,
  primary key (torneo_id, team_name)
);

-- ============================================================
-- Row Level Security: negar por defecto para "anon"/"authenticated" en
-- todo lo sensible. El tráfico real de la app pasa por Edge Functions
-- que usan la llave de servicio (ignora RLS) -- misma lógica de PIN y
-- rate limiting que ya existe en Code.gs, solo que corriendo aquí.
-- Sin una política que lo permita explícitamente, RLS niega todo --
-- por eso las tablas sensibles no tienen ninguna política de anon/
-- authenticated: eso ES la protección.
-- ============================================================

alter table groups           enable row level security;
alter table group_secrets    enable row level security;
alter table players          enable row level security;
alter table predictions      enable row level security;
alter table custom_matches   enable row level security;
alter table fixtures         enable row level security;
alter table fixture_results  enable row level security;
alter table team_crests      enable row level security;

-- Única excepción: el calendario y los escudos ya son públicos hoy sin
-- PIN (acción "getFixture" sin autenticación) -- se mantiene igual.
create policy "fixtures publicas" on fixtures
  for select to anon, authenticated using (true);
create policy "resultados publicos" on fixture_results
  for select to anon, authenticated using (true);
create policy "escudos publicos" on team_crests
  for select to anon, authenticated using (true);

-- Nota para v2 (fuera de alcance de esta migración): reemplazar el
-- "negar todo, pasar por Edge Function" por políticas RLS finas por
-- fila usando un JWT por grupo emitido tras verificar el PIN -- daría
-- aislamiento real a nivel de fila sin depender de que la Edge
-- Function esté bien escrita. No es necesario para el MVP.
