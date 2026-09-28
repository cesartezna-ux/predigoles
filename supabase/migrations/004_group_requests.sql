-- ============================================================
-- Predigoles — solicitudes de grupo desde el flujo de venta (Gumroad)
-- Cierra el hueco entre "alguien compra" y "el admin central tiene los
-- datos para crear el grupo": el comprador llena /setup, la Edge
-- Function solicitar-grupo valida y guarda aquí, y Panel Central lo
-- lista como "Solicitudes pendientes" para crear el grupo en un clic.
-- ============================================================

create table group_requests (
  id uuid primary key default gen_random_uuid(),
  grupo_id text not null check (grupo_id ~ '^[a-zA-Z0-9_-]{1,40}$'),
  nombre_grupo text not null,
  torneo_id text not null,
  modo_seguimiento text not null default 'torneo' check (modo_seguimiento in ('torneo','equipo')),
  equipos_seguidos text[] not null default '{}',
  nombre_admin text not null,
  celular_admin text not null,
  correo_admin text not null,
  pin_deseado text,
  estado text not null default 'pendiente' check (estado in ('pendiente','atendida')),
  created_at timestamptz not null default now()
);

-- Nadie lee ni escribe esta tabla directo (ni anon ni authenticated) --
-- solo las Edge Functions con la llave de servicio: solicitar-grupo
-- (pública, valida y escribe) y admin-listar-solicitudes/
-- admin-marcar-solicitud-atendida (protegidas con PIN maestro).
alter table group_requests enable row level security;
