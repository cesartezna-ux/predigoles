-- ============================================================
-- Predigoles — comentarios/feedback desde el botón flotante
-- Visible en el Home, y en la app para jugadores y organizadores de
-- cualquier grupo. Público (sin PIN) para no ponerle fricción a dejar
-- un comentario -- se valida/sanitiza en la Edge Function y se limita
-- por IP, mismo patrón que group_requests.
-- ============================================================

create table feedback (
  id uuid primary key default gen_random_uuid(),
  origen text not null check (origen in ('landing', 'jugador', 'organizador')),
  grupo_id text,
  autor_nombre text,
  mensaje text not null,
  estado text not null default 'nuevo' check (estado in ('nuevo', 'leido')),
  created_at timestamptz not null default now()
);

-- Nadie lee ni escribe esta tabla directo -- solo las Edge Functions:
-- enviar-comentario (pública, valida y escribe) y
-- admin-listar-comentarios/admin-marcar-comentario-leido (PIN maestro).
alter table feedback enable row level security;
