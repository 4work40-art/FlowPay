-- Идемпотентно: безопасно перезапускать.
-- Этап 3: подписки и биллинг через ЮKassa.

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan plan_type NOT NULL DEFAULT 'free',
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | past_due | canceled
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'yookassa',
  provider_payment_id VARCHAR(255) UNIQUE,
  plan plan_type NOT NULL,
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | succeeded | canceled
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_org_id ON billing_transactions(org_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_status ON billing_transactions(status);
