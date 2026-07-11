@echo off

echo.
echo  ============================================
echo  Schet and Kontrol - Local Setup
echo  ============================================
echo.

REM -- Check Docker exists --
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Docker not found.
    echo.
    echo  Please:
    echo  1. Download Docker Desktop from:
    echo     https://www.docker.com/products/docker-desktop/
    echo  2. Install and LAUNCH it
    echo  3. Wait for whale icon in system tray
    echo  4. Run this file again
    echo.
    start https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

REM -- Check Docker is running --
docker version >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Docker is installed but not running.
    echo.
    echo  Please start Docker Desktop and wait for
    echo  the whale icon to appear in the system tray.
    echo  Then run this file again.
    echo.
    pause
    exit /b 1
)

echo  [OK] Docker is running.
echo.
echo  Starting services (first run takes 3-5 min)...
echo.

docker compose up -d

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] docker compose failed. See log above.
    pause
    exit /b 1
)

echo.
echo  Waiting 40 seconds for services to start...
timeout /t 40 /nobreak

echo.
echo  ============================================
echo  READY FOR TESTING!
echo.
echo  App:      http://localhost:3000
echo  API:      http://localhost:3001/health
echo  Database: http://localhost:8080
echo  Redis:    http://localhost:8081
echo.
echo  Login:    demo@schyot-kontrol.ru
echo  Password: demo1234
echo  ============================================
echo.
start http://localhost:3000
pause
