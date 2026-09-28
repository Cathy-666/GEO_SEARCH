@echo off
setlocal enabledelayedexpansion

:: Find Chrome installation path
set "CHROME_PATH="

:: Try common locations
set "TRY_1=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "TRY_2=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set "TRY_3=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

for %%P in ("%TRY_1%","%TRY_2%","%TRY_3%") do (
    if exist %%P if "!CHROME_PATH!"=="" set "CHROME_PATH=%%~P"
)

:: Fallback: try PATH
if "!CHROME_PATH!"=="" (
    for /f "delims=" %%F in ('where chrome 2^>nul') do (
        if "!CHROME_PATH!"=="" set "CHROME_PATH=%%F"
    )
)

if "!CHROME_PATH!"=="" (
    echo [FAIL] Chrome not found!
    echo Please install Google Chrome or edit start_chrome.bat manually.
    pause
    exit /b 1
)

:: User data directory (inside project folder)
set "USER_DATA=%~dp0chrome_cdp"
if not exist "!USER_DATA!" mkdir "!USER_DATA!"

echo ============================================
echo   Chrome CDP Debug Mode
echo   Chrome  : !CHROME_PATH!
echo   Profile : !USER_DATA!
echo   Port    : 9223
echo ============================================
echo   DO NOT close this window while running
echo.

:: Use short 8.3 path to avoid spaces
for %%A in ("!CHROME_PATH!") do set "CHROME_SHORT=%%~sA"
for %%A in ("!USER_DATA!") do set "DATA_SHORT=%%~sA"

start "" "!CHROME_SHORT!" --remote-debugging-port=9223 --user-data-dir="!DATA_SHORT!"

timeout /t 3 /nobreak >nul

netstat -ano 2>nul | find ":9223" >nul
if !errorlevel! equ 0 (
    echo [OK] Chrome started, port 9223 ready
) else (
    echo [FAIL] Port 9223 not responding!
    echo Close the debug Chrome window and retry, or check port 9223.
)

pause
