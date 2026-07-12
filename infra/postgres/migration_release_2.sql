-- Идемпотентно: безопасно перезапускать.
-- Сводный релиз по итогам audit-2026: legal consent, автонумерация, лого, инвайты.

ALTER TABLE users ADD COLUMN IF NOT EXISTS pdn_consent_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS next_invoice_seq INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_path VARCHAR(500);

CREATE TABLE IF NOT EXISTS org_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'accountant',
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org_id ON org_invites(org_id);
