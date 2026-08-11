const { pool } = require('./db');

async function audit(orgId, userId, action, resource, resourceId, before, after) {
  try {
    await pool.query(
      `INSERT INTO audit_logs(org_id,user_id,action,resource,resource_id,before_state,after_state,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,'success')`,
      [orgId, userId, action, resource, resourceId || null,
       before ? JSON.stringify(before) : null,
       after  ? JSON.stringify(after)  : null]
    );
  } catch (e) {
    console.warn('[audit]', e.message);
  }
}

// Действие администратора платформы. Его id НЕЛЬЗЯ писать в audit_logs.user_id:
// там внешний ключ на users(id), а платформенные учётки живут в отдельной
// таблице — вставка упала бы с FK violation, и запись аудита молча терялась бы
// (audit() гасит ошибку). Пишем в отдельную колонку platform_admin_id
// (migration_platform_admin_separation.sql), user_id остаётся NULL.
async function platformAudit(orgId, admin, action, resource, resourceId, before, after) {
  try {
    await pool.query(
      `INSERT INTO audit_logs(org_id,user_id,platform_admin_id,action,resource,resource_id,before_state,after_state,status)
       VALUES($1,NULL,$2,$3,$4,$5,$6,$7,'success')`,
      [orgId, admin?.id || null, action, resource, resourceId || null,
       before ? JSON.stringify(before) : null,
       // Email администратора кладём в запись: по одному UUID в журнале
       // непонятно, кто это, а таблица platform_admins в выборки аудита не джойнится.
       JSON.stringify({ ...(after || {}), platform_admin_email: admin?.email || null })]
    );
  } catch (e) {
    console.warn('[audit:platform]', e.message);
  }
}

module.exports = { audit, platformAudit };
