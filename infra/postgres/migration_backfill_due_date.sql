-- Разовый backfill для счетов, созданных до того, как «Срок оплаты»
-- (due_date) стал обязательным полем на всех уровнях (форма создания счёта,
-- импорт реестра, серверная валидация в POST /invoices и /invoices/bulk).
-- До этого фикса due_date можно было оставить пустым, из-за чего такие
-- счета молча пропадали из «Календаря оплат» и метрик «Просроченные» /
-- «На оплату (7 дней)» на Дашборде (см. dashboard.js, calendar/page.tsx —
-- оба фильтруют/группируют по due_date и просто игнорируют NULL).
--
-- Логика простановки: due_date = COALESCE(invoice_date, created_at::date) + 14 дней —
-- тот же дефолт, что теперь предлагается на форме создания счёта
-- (см. apps/web-client/.../invoices/new/page.tsx, DEFAULT_DUE_DAYS), чтобы
-- поведение для старых и новых счетов было согласованным.
--
-- Идемпотентно: трогает только строки с due_date IS NULL, повторный запуск
-- ничего не меняет. Безопасно перезапускать, как и остальные migration_*.sql.

DO $$
DECLARE
  affected_ids UUID[];
  affected_count INTEGER;
BEGIN
  SELECT array_agg(id) INTO affected_ids
  FROM invoices
  WHERE due_date IS NULL;

  affected_count := COALESCE(array_length(affected_ids, 1), 0);

  IF affected_count > 0 THEN
    UPDATE invoices
    SET due_date = COALESCE(invoice_date, created_at::date) + INTERVAL '14 days',
        updated_at = NOW()
    WHERE id = ANY(affected_ids);

    -- Один агрегированный audit-лог на весь backfill (по одному на организацию
    -- нет смысла — скрипт запускается вручную один раз на всю базу), по
    -- аналогии со структурой audit_logs и lib/audit.js (org_id/user_id тут
    -- NULL — это не действие в рамках организации или сессии пользователя,
    -- а разовая техническая операция).
    INSERT INTO audit_logs(org_id, user_id, action, resource, resource_id, before_state, after_state, status)
    VALUES (
      NULL, NULL, 'invoice.due_date_backfilled', 'invoice', NULL,
      NULL,
      jsonb_build_object(
        'affected_count', affected_count,
        'rule', 'due_date = COALESCE(invoice_date, created_at::date) + INTERVAL ''14 days''',
        'invoice_ids', to_jsonb(affected_ids)
      ),
      'success'
    );

    RAISE NOTICE 'due_date backfill: проставлено % счетов', affected_count;
  ELSE
    RAISE NOTICE 'due_date backfill: нечего проставлять (все счета уже с due_date)';
  END IF;
END $$;
