-- ============================================================
-- Predigoles — ciudad del administrador que se inscribe
-- Útil para entender la geografía real de los grupos (ej. evaluar el
-- canal de distribución por estancos/bares del backlog). Nullable: las
-- solicitudes y grupos ya existentes no la tienen, y no hay forma de
-- rellenarla retroactivamente.
-- ============================================================

alter table group_requests add column ciudad_admin text;
alter table groups add column admin_ciudad text;
