-- Идемпотентно: безопасно перезапускать.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET is_platform_admin = true WHERE id = '00000000-0000-0000-0000-000000000002';
