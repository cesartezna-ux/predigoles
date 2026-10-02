-- ============================================================
-- Predigoles — rastreo de pago (Wompi) en las solicitudes de grupo
-- "estado" ya indica si el admin central ya la atendió (pendiente/atendida);
-- "estado_pago" es una dimensión aparte -- si Wompi ya confirmó el cobro,
-- independiente de si el admin ya creó el grupo o no.
-- ============================================================

alter table group_requests
  add column estado_pago text not null default 'pendiente' check (estado_pago in ('pendiente', 'pagado')),
  add column wompi_transaction_id text,
  add column monto_centavos int;
