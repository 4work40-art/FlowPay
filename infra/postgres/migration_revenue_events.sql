-- Идемпотентно: безопасно перезапускать.
-- Ручной учёт дохода платформы (не путать с payments — там платежи КЛИЕНТОВ
-- ваших организаций их контрагентам, а не платежи вам за подписку).
CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL DEFAULT 'payment_received',
  plan plan_type,
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'RUB',
  occurred_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_org ON subscription_events(org_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_occurred ON subscription_events(occurred_at);
