@echo off
REM Quick Start Script for Sillara-POS
echo ========================================
echo    Sillara-POS - සිල්ලර බඩු කඩය
echo ========================================
echo.
echo Starting POS System...
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo Python found! Starting web server...
    echo.
    echo Opening in browser: http://localhost:8000
    echo Press Ctrl+C to stop the server
    echo.
    start http://localhost:8000
    python -m http.server 8000
) else (
    REM Python not found, open file directly
    echo Python not found. Opening file directly in browser...
    echo.
    echo Note: For best experience, install Python and run this script again.
    echo.
    start index.html
)

pause
