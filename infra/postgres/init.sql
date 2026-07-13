SET client_encoding = 'UTF8';
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE invoice_status AS ENUM ('CREATED','UNDER_CONTROL','PAYMENT_PENDING','PARTIALLY_PAID','PAID','OVERDUE','DISPUTED','ARCHIVED','WRITTEN_OFF');
CREATE TYPE user_role AS ENUM ('owner','accountant','vendor_admin','readonly');
CREATE TYPE plan_type AS ENUM ('free','pro','business','enterprise');
CREATE TYPE pay_method AS ENUM ('bank_transfer','cash','check','online');

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  inn VARCHAR(12), kpp VARCHAR(9),
  plan plan_type NOT NULL DEFAULT 'free',
  invoice_limit INTEGER NOT NULL DEFAULT 5,
  next_invoice_seq INTEGER NOT NULL DEFAULT 1,
  logo_path VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20),
  password_hash TEXT,
  name VARCHAR(255),
  role user_role NOT NULL DEFAULT 'owner',
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  trust_score INTEGER NOT NULL DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100),
  pdn_consent_at TIMESTAMPTZ,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  inn VARCHAR(12), kpp VARCHAR(9),
  phone VARCHAR(20), email VARCHAR(255), address TEXT,
  type VARCHAR(50) DEFAULT 'vendor',
  trust_score INTEGER DEFAULT 50,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  number VARCHAR(100),
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  paid_kopecks BIGINT NOT NULL DEFAULT 0 CHECK (paid_kopecks >= 0),
  status invoice_status NOT NULL DEFAULT 'CREATED',
  invoice_date DATE, due_date DATE, notes TEXT,
  fraud_score DECIMAL(4,3) DEFAULT 0.000,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_paid CHECK (paid_kopecks <= amount_kopecks)
);

CREATE INDEX ON invoices(org_id);
CREATE INDEX ON invoices(status);
CREATE INDEX ON invoices(due_date);
CREATE INDEX ON invoices(org_id,status);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  method pay_method NOT NULL DEFAULT 'bank_transfer',
  reference VARCHAR(255),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  fraud_score DECIMAL(4,3) DEFAULT 0.000,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  import_key VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON payments(invoice_id);
CREATE INDEX ON payments(org_id);
CREATE UNIQUE INDEX payments_org_import_key_uniq
  ON payments(org_id, import_key) WHERE import_key IS NOT NULL;

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan plan_type NOT NULL DEFAULT 'free',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'yookassa',
  provider_payment_id VARCHAR(255) UNIQUE,
  plan plan_type NOT NULL,
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX ON billing_transactions(org_id);
CREATE INDEX ON billing_transactions(status);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  storage_path VARCHAR(500) NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON documents(org_id);
CREATE INDEX ON documents(invoice_id);

CREATE TABLE org_invites (
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

CREATE INDEX ON org_invites(org_id);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON password_reset_tokens(user_id);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(50),
  resource_id UUID,
  before_state JSONB,
  after_state JSONB,
  status VARCHAR(20) DEFAULT 'success',
  duration_ms INTEGER
);

CREATE INDEX ON audit_logs(timestamp DESC);
CREATE INDEX ON audit_logs(org_id);
CREATE INDEX ON audit_logs(action);

-- Ручной учёт дохода платформы (кабинет создателя, вкладка «Доход») —
-- отдельно от billing_transactions: тут фиксируются любые поступления,
-- включая ручные/офлайн, до полноценной интеграции биллинга по всем сценариям.
CREATE TABLE subscription_events (
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
CREATE INDEX ON subscription_events(org_id);
CREATE INDEX ON subscription_events(occurred_at);

-- Seed: только организация и логин-пользователь.
-- Название организации можно поменять через Adminer (таблица organizations) —
-- логин/пароль ниже не трогаем, чтобы не сломать текущий доступ.
INSERT INTO organizations (id,name,inn,kpp,plan,invoice_limit,is_active,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000001','ООО СтройМонтаж','1234567890','123456789','free',5,true,NOW(),NOW());

INSERT INTO users (id,email,password_hash,name,role,org_id,trust_score,is_platform_admin) VALUES
  ('00000000-0000-0000-0000-000000000002','demo@schyot-kontrol.ru',crypt('demo1234',gen_salt('bf')),'Иванов Иван Иванович','owner','00000000-0000-0000-0000-000000000001',85,true);
