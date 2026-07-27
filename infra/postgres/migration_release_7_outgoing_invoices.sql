-- Выставленные счета (счета, которые организация выставляет своим клиентам,
-- в отличие от `invoices` — счетов от поставщиков, которые организация
-- оплачивает). Отдельная сущность: направление денег противоположное,
-- своя нумерация, свой набор реквизитов (продавец — сама организация).

-- Реквизиты организации, нужные для формы "Счёт на оплату" по продавцу:
-- банк, счёт, подписанты. ИНН/КПП уже есть.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS address VARCHAR(500),
  ADD COLUMN IF NOT EXISTS bank_account VARCHAR(20),
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bank_bik VARCHAR(9),
  ADD COLUMN IF NOT EXISTS bank_corr_account VARCHAR(20),
  ADD COLUMN IF NOT EXISTS director_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS accountant_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS next_outgoing_invoice_seq INTEGER NOT NULL DEFAULT 1;

DO $$ BEGIN
  CREATE TYPE outgoing_invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS outgoing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  number VARCHAR(50) NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  basis VARCHAR(500),                          -- "Основание": договор №... от ...
  vat_mode VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (vat_mode IN ('none', 'rate')),
  vat_rate NUMERIC(4,2) NOT NULL DEFAULT 0,     -- 0/10/20/22 — ставка, действует только при vat_mode='rate'
  amount_kopecks BIGINT NOT NULL DEFAULT 0,     -- сумма по позициям, пересчитывается сервером
  vat_kopecks BIGINT NOT NULL DEFAULT 0,        -- НДС "в том числе", пересчитывается сервером
  status outgoing_invoice_status NOT NULL DEFAULT 'draft',
  notes VARCHAR(1000),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, number)
);
CREATE INDEX IF NOT EXISTS ON outgoing_invoices(org_id);
CREATE INDEX IF NOT EXISTS ON outgoing_invoices(org_id, status);

CREATE TABLE IF NOT EXISTS outgoing_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  outgoing_invoice_id UUID NOT NULL REFERENCES outgoing_invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit VARCHAR(50),
  unit_price_kopecks BIGINT NOT NULL CHECK (unit_price_kopecks > 0),
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ON outgoing_invoice_items(outgoing_invoice_id);
