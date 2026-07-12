const path = require('path');
const fs   = require('fs');

// Локальное дисковое хранилище — соответствует текущей стадии проекта
// (1 VPS, ROADMAP.md Этап 5: переезд на S3-совместимое хранилище — когда
// появится реальная нагрузка, не раньше).
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = { UPLOAD_DIR };
