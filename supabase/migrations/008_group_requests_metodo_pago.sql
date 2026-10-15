-- ============================================================
-- Predigoles — método de pago elegido en una solicitud de grupo
-- "estado_pago" (006) ya dice si está pagada o no; esta columna dice CÓMO
-- se espera que se pague, para que Panel Central distinga de un vistazo
-- las solicitudes que se confirman solas (Wompi, por webhook) de las que
-- hay que verificar a mano contra la app del banco (transferencia Bre-B).
-- ============================================================

alter table group_requests
  add column metodo_pago text not null default 'wompi' check (metodo_pago in ('wompi', 'transferencia'));
