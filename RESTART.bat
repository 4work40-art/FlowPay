@echo off
echo Rebuilding and restarting all services...
echo (this takes 3-5 minutes)
echo.
docker compose down
docker compose build --no-cache
docker compose up -d
echo.
echo Done. Opening browser in 40 seconds...
timeout /t 40 /nobreak
start http://localhost:3000
pause
