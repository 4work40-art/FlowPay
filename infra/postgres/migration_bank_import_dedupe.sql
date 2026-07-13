-- Идемпотентность импорта банковской выписки: у платежа, созданного
-- импортом, хранится хэш исходной строки выписки; повторный импорт той же
-- строки не создаёт дубль (частичный уникальный индекс + ON CONFLICT).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS import_key VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS payments_org_import_key_uniq
  ON payments(org_id, import_key) WHERE import_key IS NOT NULL;
