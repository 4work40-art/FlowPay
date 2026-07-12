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

module.exports = { audit };
