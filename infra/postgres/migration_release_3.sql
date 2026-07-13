-- Release 3: управляемая публичная ссылка на счёт.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS public_enabled BOOLEAN NOT NULL DEFAULT true;
