-- ============================================================
-- Predigoles — soporte de Bold como segunda pasarela automática
-- "bold" se agrega como tercer valor de metodo_pago (junto a wompi y
-- transferencia); bold_payment_id guarda el id de la transacción de Bold
-- que confirmó el pago, mismo rol que wompi_transaction_id, para auditar
-- cuál pasarela resolvió cada solicitud.
-- ============================================================

alter table group_requests drop constraint group_requests_metodo_pago_check;
alter table group_requests add constraint group_requests_metodo_pago_check check (metodo_pago in ('wompi', 'transferencia', 'bold'));

alter table group_requests add column bold_payment_id text;
