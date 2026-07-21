-- Release 4: банковские реквизиты и ОГРН контрагента — переносим из
-- распознанных счетов/платёжек в систему, а не просто показываем и теряем.
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS ogrn VARCHAR(15);
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS bank_account VARCHAR(20);
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255);
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS bank_bik VARCHAR(9);
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS bank_corr_account VARCHAR(20);
