-- Release 6: напоминания о платеже до наступления срока оплаты.
-- Настраивается на уровне организации, а не глобальной переменной окружения.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS reminder_days_before INTEGER NOT NULL DEFAULT 3
  CHECK (reminder_days_before BETWEEN 0 AND 30);
