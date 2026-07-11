# Счёт&Контроль — v3 (стили исправлены)

## Изменения в v3

**Проблема:** Tailwind CSS не компилировался в Docker — отображался только текст без стилей.

**Решение:** Полностью удалён Tailwind. Заменён на чистый CSS файл (`src/styles/globals.css`)
который работает без сборки, без PostCSS, без конфигурации — сразу.

## Запуск (Windows)

1. Распакуй архив: правой кнопкой → **Извлечь всё**
2. Войди в папку `schyot-kontrol`
3. Двойной клик на **INSTALL_WINDOWS.bat**
4. Дождись сообщения "ГОТОВО!" и открытия браузера

**Требование:** Docker Desktop запущен (иконка кита в трее)

## Адреса

| Сервис | URL |
|--------|-----|
| Приложение | http://localhost:3000 |
| API Health | http://localhost:3001/health |
| Dashboard API | http://localhost:3001/api/v1/dashboard |
| База данных (Adminer) | http://localhost:8080 |
| Redis UI | http://localhost:8081 |

## Логин

```
demo@schyot-kontrol.ru / demo1234
```

## Bat файлы

| Файл | Назначение |
|------|-----------|
| INSTALL_WINDOWS.bat | Первый запуск |
| STOP.bat | Остановить |
| RESTART.bat | Пересобрать и перезапустить |
| LOGS.bat | Логи в реальном времени |
| STATUS.bat | Статус контейнеров |
| RESET_DB.bat | Сброс БД + demo данные |

## Adminer (просмотр базы)

http://localhost:8080
- Сервер: `postgres`
- Пользователь: `sk_user`
- Пароль: `sk_secret_local`
- База: `schyot_kontrol`

## Бэкапы (боевой сервер)

Ежедневно в 03:00 по крону выполняется `backup.sh` — дамп БД в `backups/`, хранятся последние 14 дней.

Восстановить из бэкапа:
```bash
cd /opt/FlowPay
gunzip -c backups/schyot_kontrol_ФАЙЛ.sql.gz | docker compose exec -T postgres psql -U sk_user schyot_kontrol
```

## Авторизация

Вход по email/паролю выдаёт подписанный JWT (24 часа). Все API-эндпоинты, кроме `/health` и `/auth/login`, требуют заголовок `Authorization: Bearer <token>`. Logout инвалидирует токен через Redis.

## Troubleshooting

**Проблема: нет стилей** → `RESTART.bat`

**Проблема: данные не загружаются** → проверь http://localhost:3001/health

**Проблема: всё сломалось** → `RESET_DB.bat` (сбрасывает всё до нуля)

**Проверить API вручную (Windows PowerShell):**
```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/api/v1/dashboard
Invoke-RestMethod http://localhost:3001/api/v1/invoices
```
