-- Идемпотентно: безопасно перезапускать.
-- Этап 1 (multi-tenancy): free-тариф — 5 счетов (согласовано, было 10).
ALTER TABLE organizations ALTER COLUMN invoice_limit SET DEFAULT 5;
UPDATE organizations SET invoice_limit = 5 WHERE plan = 'free' AND invoice_limit = 10;
