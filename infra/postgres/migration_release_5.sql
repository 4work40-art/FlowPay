-- Release 5: позиции счёта (товары/услуги) — основа для учёта купленного:
-- количество, цена за единицу, дальнейшая аналитика по динамике цены и
-- сезонности закупок. Название позиции — свободный текст (не привязано к
-- отдельному справочнику номенклатуры, чтобы не усложнять ввод); группировка
-- в аналитике идёт по нормализованному (нижний регистр, обрезанные пробелы)
-- названию.
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit VARCHAR(50),
  unit_price_kopecks BIGINT NOT NULL CHECK (unit_price_kopecks > 0),
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_items_org_idx ON invoice_items(org_id);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id);
-- Аналитика группирует по названию товара в пределах организации.
CREATE INDEX IF NOT EXISTS invoice_items_org_name_idx ON invoice_items(org_id, lower(trim(name)));
