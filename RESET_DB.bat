@echo off
echo WARNING: This will DELETE ALL DATA and reload demo data!
echo.
set /p CONFIRM=Type YES to confirm: 
if /i "%CONFIRM%" neq "YES" (
    echo Cancelled.
    pause
    exit /b 0
)
echo Resetting...
docker compose down -v
docker compose up -d
echo.
echo Done. Demo data loaded.
timeout /t 40 /nobreak
start http://localhost:3000
pause
